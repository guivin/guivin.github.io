---
title: "DIY : Surveiller la température et l'humidité avec DHT22/AM2302 et Prometheus"
date: 2021-02-25T10:47:13+02:00
tags:
  - raspberry
  - observability
  - prometheus
---

Surveiller les conditions environnementales permet de combiner l'IoT avec les outils d'observabilité cloud-native. Dans cet article, nous construisons une configuration pour surveiller la température et l'humidité à l'aide d'un Raspberry Pi et d'un capteur DHT22 (AM2302).

Au programme :
- câblage du capteur sur le Raspberry Pi
- collecte des données du capteur
- exposition des mesures via un exporter Prometheus personnalisé écrit en Go
- visualisation dans Grafana

## Présentation du capteur : AM2302 (DHT22)

![Photo du capteur AM2302](/monitor-temperature-humidity-dht22-am2302-prometheus/am2302-sensor.webp)

L'AM2302 est une version filaire du DHT22. Peu coûteux et simple à intégrer avec les GPIO du Raspberry Pi.

### Caractéristiques principales :

* Tension : 3V à 5V (logique et alimentation)
* Consommation : max 2,5 mA lors des mesures
* Plage d'humidité : 0–100% HR (±2–5%)
* Plage de température : -40°C à +80°C (±0,5°C)
* Fréquence d'échantillonnage : max une lecture toutes les 2 secondes (0,5 Hz)
* Dimensions : 15,1 mm × 25 mm × 7,7 mm
* Interface : header 4 broches (espacement 0,1")

Il est suffisamment précis pour une utilisation en intérieur et facile à intégrer avec les GPIO d'un Raspberry Pi.

### Câblage du capteur sur le Pi

Le câblage de l'AM2302 est simple :

| Broche capteur | Fonction       | Broche Raspberry Pi |
|----------------|----------------|---------------------|
| 1              | VCC (Alim.)    | 3,3V (Pin 1)        |
| 2              | Data           | GPIO 4 (Pin 7)      |
| 3              | Non utilisée   | -                   |
| 4              | GND            | Ground (Pin 6)      |


### Tester le capteur

Avant d'écrire un exporter Prometheus, testez le capteur avec un script Python basique.

Installer les dépendances :

```
$ sudo apt-get update
$ sudo apt-get install python3 python3-pip
$ python3 -m pip install --upgrade pip
$ python3 -m pip install Adafruit-DHT
```

Le script de test :

```python
import Adafruit_DHT

sensor = Adafruit_DHT.DHT22
pin = 4

humidity, temperature = Adafruit_DHT.read_retry(sensor, pin)
print(f'Temp: {temperature:.1f}°C, Humidity: {humidity:.1f}%')
```

Rendre le script exécutable et le lancer :

```
$ chmod +x am2302_tester.py
$ python3 am2302_tester.py
Temp=19.2*C  Humidity=55.0%
```

Tout fonctionne correctement. On peut maintenant passer au développement de l'exporter Prometheus.

## Écriture d'un exporter Prometheus en Go

### Configuration

La configuration est un fichier YAML dont l'emplacement suit cet ordre de priorité :
1. `/etc/dht-prometheus-exporter.yml`
2. `$HOME/dht-prometheus-exporter.yml`
3. `$PWD/dht-prometheus-exporter.yml`

Le package viper gère le fichier de configuration et stocke les valeurs dans une struct. Les informations récurrentes sont ainsi accessibles aux autres parties du projet.

```go
package main

import (
	"fmt"
	"github.com/spf13/viper"
)

type Config struct {
	path            string
	name            string
	gpio            string
	maxRetries      int
	listenPort      int
	defaultLogLevel string
	temperatureUnit string
}

func ReadConfig() *Config {
	/**
	Reads YAML configuration file and create a struct containing the values
	**/
	viper.SetConfigName("dht-prometheus-exporter")
	viper.SetConfigType("yaml")
	viper.AddConfigPath("/etc")
	viper.AddConfigPath("$HOME")
	viper.AddConfigPath(".")
	err := viper.ReadInConfig()

	if err != nil {
		panic(fmt.Sprintf("Error when reading config file: %v", err))
	}

	config := &Config{
		path:            viper.ConfigFileUsed(),
		name:            viper.GetString("name"),
		gpio:            fmt.Sprintf("GPIO%d", viper.GetInt("gpio_pin")),
		maxRetries:      viper.GetInt("max_retries"),
		listenPort:      viper.GetInt("listen_port"),
		defaultLogLevel: viper.GetString("log_level"),
		temperatureUnit: viper.GetString("temperature_unit"),
	}

	return config
}
```

### Logging

Le package logrus gère les logs et réutilise le niveau défini dans la configuration :

```go
package main

import (
	log "github.com/sirupsen/logrus"
	"os"
	"sync"
)

const defaultLogLevel = log.InfoLevel

var (
	once     sync.Once
	instance log.Logger
)

func LogLevel(levelName string) log.Level {
	/**
	Set the log level of logrus following the value supplied in the configuration
	*/
	var logLevel log.Level

	switch levelName {
	case "debug":
		logLevel = log.DebugLevel
	case "info":
		logLevel = log.InfoLevel
	case "warn":
		logLevel = log.WarnLevel
	case "error":
		logLevel = log.ErrorLevel
	case "fatal":
		logLevel = log.FatalLevel
	case "panic":
		logLevel = log.PanicLevel
	default:
		logLevel = defaultLogLevel
	}

	return logLevel
}

func getLogger(config *Config) log.Logger {
	/**
	Singleton to get the same logger instance everywhere
	*/
	once.Do(func() {
		instance = log.Logger{
			Out:   os.Stderr,
			Level: LogLevel(config.defaultLogLevel),
			Formatter: &log.TextFormatter{
				DisableColors: true,
				FullTimestamp: true,
			},
		}
	})

	return instance
}
```

### Capteur

Le package go-dht fait l'interface avec le capteur. Il fournit déjà une fonction pour lire les données depuis la broche GPIO.

Une struct contient les métriques collectées :

```go
package main

import (
	"fmt"
	"github.com/MichaelS11/go-dht"
)

type Sensor struct {
	config            *Config
	temperatureSymbol string
	client            *dht.DHT
}

const CelsiusSymbol = "C"
const FahrenheitSymbol = "F"

func newSensor(config *Config) *Sensor {
	/**
	Sensor constructor
	*/
	var err error
	var client *dht.DHT
	var temperatureSymbol string

	lg.Info("Initializing the DHT22/AM2302 sensor on the host")
	err = dht.HostInit()
	if err != nil {
		lg.Panic("Failed to initialized DHT22/AM2302 sensor on the host: ", err)
	}

	if config.temperatureUnit == "celsius" {
		client, err = dht.NewDHT(config.gpio, dht.Celsius, "")
		temperatureSymbol = CelsiusSymbol
	} else {
		client, err = dht.NewDHT(config.gpio, dht.Fahrenheit, "")
		temperatureSymbol = FahrenheitSymbol
	}

	if err != nil {
		lg.Panic("Failed to create new DHT client: ", err)
	}

	return &Sensor{
		config:            config,
		temperatureSymbol: temperatureSymbol,
		client:            client,
	}
}

func (s *Sensor) readRetry() (humidity float64, temperature float64, err error) {
	/**
	Reads the sensor data with retry
	*/
	humidity, temperature, err = s.client.ReadRetry(s.config.maxRetries)
	if err != nil {
		lg.Error("Cannot retrieve humidity and temperature from the sensor: ", err)
	}
	lg.Info(fmt.Sprintf("Retrieved humidity=%.2f%%, temperature=%.2f°%s from the sensor",
		humidity, temperature, s.temperatureSymbol))
	return humidity, temperature, err
}
```

### Collector Prometheus

Le package Prometheus fournit le collector. Il liste les différentes métriques à collecter et les expose. Les métriques d'humidité et de température sont dans le même collector. Les métriques ont des labels pour donner plus de contexte :

* `dht_name` : nom du capteur pour l'identifier facilement (en cas de capteurs multiples)
* `hostname`
* `unit` : l'unité de température en Fahrenheit ou Celsius

Les fonctions Describe et Collect sont déjà implémentées dans le package Prometheus. Nous devons les redéfinir pour les surcharger avec nos métriques :

```go
package main

import (
	"github.com/prometheus/client_golang/prometheus"
	"os"
)

type Collector struct {
	sensor            *Sensor
	temperatureMetric *prometheus.Desc
	humidityMetric    *prometheus.Desc
}

func newCollector(s *Sensor) *Collector {
	lg.Debug("Creating a new prometheus collector for the sensor")
	return &Collector{
		sensor: s,
		temperatureMetric: prometheus.NewDesc("dht_temperature_degree",
			"Temperature degree measured by the sensor",
			[]string{"dht_name", "hostname", "unit"}, nil,
		),
		humidityMetric: prometheus.NewDesc("dht_humidity_percent",
			"Humidity percent measured by the sensor",
			[]string{"dht_name", "hostname"}, nil,
		),
	}
}

func (c *Collector) Describe(ch chan<- *prometheus.Desc) {
	ch <- c.temperatureMetric
	ch <- c.humidityMetric
}

func (c *Collector) Collect(ch chan<- prometheus.Metric) {
	humidity, temperature, _ := c.sensor.readRetry()
	hostname, err := os.Hostname()
	temperatureUnit := c.sensor.config.temperatureUnit
	dhtName := c.sensor.config.name
	if err != nil {
		lg.Error("Failed to get hostname")
	}
	ch <- prometheus.MustNewConstMetric(c.temperatureMetric, prometheus.CounterValue, temperature, dhtName, hostname, temperatureUnit)
	ch <- prometheus.MustNewConstMetric(c.humidityMetric, prometheus.CounterValue, humidity, dhtName, hostname)
}
```

### Fichier principal

Le fichier principal assemble les fonctions des fichiers précédents. Il crée le client chargé de lire les données depuis la broche GPIO, instancie le collector avec ce client et l'enregistre.

Il configure ensuite le serveur `promhttp` avec le logging et le démarre. Les métriques sont accessibles sur le chemin `/metrics` :

```go
package main

import (
	"fmt"
	"github.com/coreos/go-systemd/daemon"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promhttp"
	log "github.com/sirupsen/logrus"
	stdlibLog "log"
	"net/http"
)

var lg log.Logger

func main() {
	config := ReadConfig()
	lg = getLogger(config)
	w := lg.Writer()
	defer w.Close()
	sensor := newSensor(config)
	collector := newCollector(sensor)
	lg.Debug("Registering the prometheus collector")
	prometheus.MustRegister(collector)
	http.Handle("/metrics", promhttp.HandlerFor(prometheus.DefaultGatherer, promhttp.HandlerOpts{
		ErrorLog: stdlibLog.New(w, "", 0),
	}))
	lg.Info(fmt.Sprintf("Starting http server on TCP/%d port", config.listenPort))
	lg.Fatal(http.ListenAndServe(fmt.Sprintf(":%d", config.listenPort), nil))
	daemon.SdNotify(false, daemon.SdNotifyReady)
}
```

Une fois démarré, le binaire expose les métriques collectées sur requête :

```
$ pi@raspberrypi:~/go/src/github.com/guivin/dht-prometheus-exporter $ ./dht-exporter
time="2021-02-17T20:19:20Z" level=info msg="Initializing the DHT22/AM2302 sensor on the host"
time="2021-02-17T20:19:20Z" level=info msg="Starting http server on TCP/8080 port"
time="2021-02-17T20:19:36Z" level=info msg="Retrieved humidity=62.70%, temperature=68.90°F from the sensor"
```

La requête se fait sur le port TCP/8080 :

```
# HELP dht_humidity_percent Humidity percent measured by the sensor
# TYPE dht_humidity_percent counter
dht_humidity_percent{dht_name="test",hostname="raspberrypi"} 62.8
# HELP dht_temperature_degree Temperature degree measured by the sensor
# TYPE dht_temperature_degree counter
dht_temperature_degree{dht_name="test",hostname="raspberrypi",unit="fahrenheit"} 68.9
# HELP go_gc_duration_seconds A summary of the GC invocation durations.
# TYPE go_gc_duration_seconds summary
go_gc_duration_seconds{quantile="0"} 0
go_gc_duration_seconds{quantile="0.25"} 0
go_gc_duration_seconds{quantile="0.5"} 0
go_gc_duration_seconds{quantile="0.75"} 0
go_gc_duration_seconds{quantile="1"} 0
go_gc_duration_seconds_sum 0
go_gc_duration_seconds_count 0
# HELP go_goroutines Number of goroutines that currently exist.
# TYPE go_goroutines gauge
go_goroutines 12
# HELP go_info Information about the Go environment.
# TYPE go_info gauge
go_info{version="go1.11.6"} 1
# HELP go_memstats_alloc_bytes Number of bytes allocated and still in use.
# TYPE go_memstats_alloc_bytes gauge
go_memstats_alloc_bytes 1.798512e+06
# HELP go_memstats_alloc_bytes_total Total number of bytes allocated, even if freed.
# TYPE go_memstats_alloc_bytes_total counter
go_memstats_alloc_bytes_total 1.798512e+06
# HELP go_memstats_buck_hash_sys_bytes Number of bytes used by the profiling bucket hash table.
# TYPE go_memstats_buck_hash_sys_bytes gauge
go_memstats_buck_hash_sys_bytes 724468
# HELP go_memstats_frees_total Total number of frees.
# TYPE go_memstats_frees_total counter
go_memstats_frees_total 1026
# HELP go_memstats_gc_cpu_fraction The fraction of this program's available CPU time used by the GC since the program started.
# TYPE go_memstats_gc_cpu_fraction gauge
go_memstats_gc_cpu_fraction 0
# HELP go_memstats_gc_sys_bytes Number of bytes used for garbage collection system metadata.
# TYPE go_memstats_gc_sys_bytes gauge
go_memstats_gc_sys_bytes 334848
# HELP go_memstats_heap_alloc_bytes Number of heap bytes allocated and still in use.
# TYPE go_memstats_heap_alloc_bytes gauge
go_memstats_heap_alloc_bytes 1.798512e+06
# HELP go_memstats_heap_idle_bytes Number of heap bytes waiting to be used.
# TYPE go_memstats_heap_idle_bytes gauge
go_memstats_heap_idle_bytes 589824
# HELP go_memstats_heap_inuse_bytes Number of heap bytes that are in use.
# TYPE go_memstats_heap_inuse_bytes gauge
go_memstats_heap_inuse_bytes 3.11296e+06
# HELP go_memstats_heap_objects Number of allocated objects.
# TYPE go_memstats_heap_objects gauge
go_memstats_heap_objects 6257
# HELP go_memstats_heap_released_bytes Number of heap bytes released to OS.
# TYPE go_memstats_heap_released_bytes gauge
go_memstats_heap_released_bytes 0
# HELP go_memstats_heap_sys_bytes Number of heap bytes obtained from system.
# TYPE go_memstats_heap_sys_bytes gauge
go_memstats_heap_sys_bytes 3.702784e+06
# HELP go_memstats_last_gc_time_seconds Number of seconds since 1970 of last garbage collection.
# TYPE go_memstats_last_gc_time_seconds gauge
go_memstats_last_gc_time_seconds 0
# HELP go_memstats_lookups_total Total number of pointer lookups.
# TYPE go_memstats_lookups_total counter
go_memstats_lookups_total 0
# HELP go_memstats_mallocs_total Total number of mallocs.
# TYPE go_memstats_mallocs_total counter
go_memstats_mallocs_total 7283
# HELP go_memstats_mcache_inuse_bytes Number of bytes in use by mcache structures.
# TYPE go_memstats_mcache_inuse_bytes gauge
go_memstats_mcache_inuse_bytes 3456
# HELP go_memstats_mcache_sys_bytes Number of bytes used for mcache structures obtained from system.
# TYPE go_memstats_mcache_sys_bytes gauge
go_memstats_mcache_sys_bytes 16384
# HELP go_memstats_mspan_inuse_bytes Number of bytes in use by mspan structures.
# TYPE go_memstats_mspan_inuse_bytes gauge
go_memstats_mspan_inuse_bytes 22080
# HELP go_memstats_mspan_sys_bytes Number of bytes used for mspan structures obtained from system.
# TYPE go_memstats_mspan_sys_bytes gauge
go_memstats_mspan_sys_bytes 32768
# HELP go_memstats_next_gc_bytes Number of heap bytes when next garbage collection will take place.
# TYPE go_memstats_next_gc_bytes gauge
go_memstats_next_gc_bytes 4.473924e+06
# HELP go_memstats_other_sys_bytes Number of bytes used for other system allocations.
# TYPE go_memstats_other_sys_bytes gauge
go_memstats_other_sys_bytes 1.315464e+06
# HELP go_memstats_stack_inuse_bytes Number of bytes in use by the stack allocator.
# TYPE go_memstats_stack_inuse_bytes gauge
go_memstats_stack_inuse_bytes 491520
# HELP go_memstats_stack_sys_bytes Number of bytes obtained from system for stack allocator.
# TYPE go_memstats_stack_sys_bytes gauge
go_memstats_stack_sys_bytes 491520
# HELP go_memstats_sys_bytes Number of bytes obtained from system.
# TYPE go_memstats_sys_bytes gauge
go_memstats_sys_bytes 6.618236e+06
# HELP go_threads Number of OS threads created.
# TYPE go_threads gauge
go_threads 9
# HELP process_cpu_seconds_total Total user and system CPU time spent in seconds.
# TYPE process_cpu_seconds_total counter
process_cpu_seconds_total 0.16
# HELP process_max_fds Maximum number of open file descriptors.
# TYPE process_max_fds gauge
process_max_fds 1024
# HELP process_open_fds Number of open file descriptors.
# TYPE process_open_fds gauge
process_open_fds 101
# HELP process_resident_memory_bytes Resident memory size in bytes.
# TYPE process_resident_memory_bytes gauge
process_resident_memory_bytes 1.0858496e+07
# HELP process_start_time_seconds Start time of the process since unix epoch in seconds.
# TYPE process_start_time_seconds gauge
process_start_time_seconds 1.61359321311e+09
# HELP process_virtual_memory_bytes Virtual memory size in bytes.
# TYPE process_virtual_memory_bytes gauge
process_virtual_memory_bytes 8.93046784e+08
# HELP process_virtual_memory_max_bytes Maximum amount of virtual memory available in bytes.
# TYPE process_virtual_memory_max_bytes gauge
process_virtual_memory_max_bytes 1.8446744073709552e+19
```

## Déployer l'exporter Prometheus sur le Raspberry

Installer `golang` et `make` pour compiler le code source :

```
sudo apt install golang make
```

Définir les variables d'environnement pour Golang :

```
export GOPATH=$HOME/go
export GOBIN=$GOPATH/bin
export PATH=$PATH:$GOBIN
```

Télécharger le package dep :

```
go get -u github.com/golang/dep/cmd/dep
```

Cloner le dépôt git et compiler les sources :

```
go get -u github.com/guivin/dht-prometheus-exporter.git
cd $GOPATH/src/guivin/dht-prometheus-exporter
git checkout tags/v0.1
make all
```

Installer le service systemd :

```
sudo cp dht-prometheus-exporter.service /etc/systemd/system
```

Déployer le fichier de configuration :

```
sudo cp dht-prometheus-exporter.yml /etc
sudo chown dht-prometheus-exporter:dht-prometheus-exporter /etc/dht-prometheus-exporter.yml
sudo chmod 0640 /etc/dht-prometheus-exporter.yml
```

Créer un utilisateur et groupe système `dht-prometheus-exporter` pour l'exporter. Cet utilisateur appartient aussi au groupe `gpio` en tant que groupe secondaire pour lire les broches GPIO :

```
sudo useradd --user-group --groups gpio --no-create-home --system --shell /usr/sbin/nologin dht-prometheus-exporter
```

Démarrer le service systemd :

```
sudo systemctl daemon-reload
sudo systemctl start dht-prometheus-exporter
```

Vérifier les logs du service systemd :

```
$ sudo journalctl -u dht-prometheus-exporter -f
Feb 18 07:14:25 raspberrypi dht-prometheus-exporter[4031]: time="2021-02-18T07:14:25Z" level=info msg="Initializing the DHT22/AM2302 sensor on the host"
Feb 18 07:14:25 raspberrypi dht-prometheus-exporter[4031]: time="2021-02-18T07:14:25Z" level=info msg="Starting http server on TCP/8080 port"
```

## Enregistrer l'exporter dans Prometheus

Créer l'utilisateur et le groupe système prometheus :

```
useradd --home-dir /opt/prometheus --user-group --shell /usr/sbin/nologin --system prometheus
```

Télécharger le binaire prometheus et adapter selon l'architecture de votre Raspberry Pi (ici armv7) :

```
cd /tmp
wget https://github.com/prometheus/prometheus/releases/download/v2.25.0/prometheus-2.25.0.linux-armv7.tar.gz
tar xzf prometheus-2.25.0.linux-armv7.tar.gz
```

Créer le répertoire home pour l'utilisateur `prometheus` dans `/opt/prometheus` :

```
sudo cp -r prometheus-2.25.0.linux-armv7 /opt/prometheus
sudo chown prometheus:prometheus /opt/prometheus
sudo chmod 0740 -R /opt/prometheus
```

Créer le répertoire `/var/lib/prometheus` avec les bonnes permissions pour le stockage tsdb (base de données de séries temporelles) :

```
sudo mkdir /var/lib/prometheus
sudo chown -R prometheus:prometheus /var/lib/prometheus
sudo chmod -R 0740 /var/lib/prometheus
```

Créer un lien symbolique depuis la configuration dans `/opt/prometheus` vers `/etc` :

```
sudo ln -s /opt/prometheus/prometheus.yml /etc/prometheus.yml
```

Mettre à jour `/etc/prometheus.yml` et ajouter un nouveau job dans le bloc `scrape_configs` :

```yaml
- job_name: 'dht-prometheus-exporter'
  static_configs:
    - targets: ['localhost:8080']
```

Créer un service systemd pour prometheus dans `/etc/systemd/system/prometheus.service` :

```
[Service]
Type=simple
User=prometheus
Group=prometheus
ExecReload=/bin/kill -HUP $MAINPID
ExecStart=/opt/prometheus/prometheus \
  --config.file=/etc/prometheus/prometheus.yml \
  --storage.tsdb.path=/var/lib/prometheus \
  --storage.tsdb.retention.time=30d \
  --storage.tsdb.retention.size=0 \
  --web.console.libraries=/opt/prometheus/console_libraries \
  --web.console.templates=/opt/prometheus/consoles \
  --web.listen-address=0.0.0.0:9090 \
  --web.external-url=
SyslogIdentifier=prometheus
Restart=always

[Install]
WantedBy=multi-user.target
```

Démarrer et activer le service prometheus :

```
sudo systemctl daemon-reload
sudo systemctl start prometheus
sudo systemctl enable prometheus
```

Vérifier que prometheus fonctionne :

```
sudo systemctl status prometheus --no-pager
```

Notez l'IP privée de votre Raspberry Pi avec la commande `ip a`.

Ouvrez votre navigateur et connectez-vous via le port TCP/8080 avec le schéma HTTP (ex. http://<IP_RASPBERRY>:8080).

L'exporter est bien enregistré dans le menu "Targets" :

![Exporter enregistré dans les targets Prometheus](/monitor-temperature-humidity-dht22-am2302-prometheus/exporter-registered-in-prometheus-targets.webp)

Sur la page d'accueil de l'interface Prometheus, nous saisissons les noms des deux métriques de l'exporter. Elles sont présentes et affichent les labels définis précédemment :

![Métrique d'humidité](/monitor-temperature-humidity-dht22-am2302-prometheus/humidity-metrics-in-prometheus.webp)

![Métrique de température](/monitor-temperature-humidity-dht22-am2302-prometheus/temperature-metrics-in-prometheus.webp)

On peut également afficher un graphe des métriques de l'exporter :

![Graphe d'humidité dans Prometheus](/monitor-temperature-humidity-dht22-am2302-prometheus/metric-graph-in-prometheus.webp)

## Grafana

### Installation

Pour Grafana, vous pouvez suivre les instructions disponibles ici : https://grafana.com/tutorials/install-grafana-on-raspberry-pi

### Création du dashboard

On accède à l'interface Grafana et on crée un nouveau dashboard. Sur ce dashboard, on ajoute un graphe séparé pour chaque métrique : température et humidité.

Pour les deux graphes, on utilise la fonction PromQL `avg_over_time` avec un vecteur de plage d'1 minute. Cette approche lisse les données et évite les trous ou discontinuités dans les graphes.

![Panel température dans Grafana](/monitor-temperature-humidity-dht22-am2302-prometheus/temperature-grafana-panel.webp)
![Panel humidité dans Grafana](/monitor-temperature-humidity-dht22-am2302-prometheus/humidity-grafana-panel.webp)


## Conclusion

À travers ces étapes, nous avons construit un système de monitoring complet à partir d'un capteur et d'un Raspberry Pi. Nous avons câblé le capteur, validé l'acquisition des données et mesuré avec succès la température et l'humidité ambiantes.

Pour exposer ces métriques à Prometheus, nous avons développé un exporter personnalisé en Go qui sert les données via un endpoint HTTP. Nous avons aussi ajouté des labels à nos métriques, ce qui est essentiel pour suivre plusieurs capteurs et les distinguer.

Ensuite, nous avons installé et configuré Prometheus sur le Raspberry Pi pour scraper l'exporter et stocker les métriques. Via l'interface de Prometheus, on peut interroger et analyser les données efficacement.

Alors que Prometheus offre une visualisation basique, nous avons enrichi l'expérience en ajoutant Grafana, créant un dashboard riche et interactif affichant les tendances de température et d'humidité.

Ce projet couvre l'ensemble du pipeline : collecte, stockage et visualisation des données depuis un capteur physique.
