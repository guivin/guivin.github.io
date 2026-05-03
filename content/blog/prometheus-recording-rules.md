---
title: "Recording rules : la feature Prometheus que j'aurais dû connaître bien plus tôt"
date: 2026-05-01T19:39:33+02:00
tags:
  - observabilité
  - prometheus
---

# Recording rules : la feature Prometheus que j'aurais dû connaître bien plus tôt

Je voulais réaliser des stats de storage sur des Elasticsearch avec beaucoup d'index sur plus de 30 jours dans Grafana.

Mon problème : agréger des métriques à forte cardinalité sur de longues périodes. Les panels étaient trop lents à 
charger. Ce n'était pas acceptable au niveau de l'expérience utilisateur. 

Alors j'ai fouillé la doc Prometheus et, bien caché, j'ai découvert les 
[recording rules](https://prometheus.io/docs/practices/rules/).

## C'est quoi les recording rules ?

Le principe est simple : Prometheus évalue une expression PromQL à interval régulier et ingère le résultat comme une 
nouvelle métrique. Au lieu de recalculer à chaque chargement de dashboard, le résultat est déjà là.

Pratique pour garder les dashboards rapides. Et le résultat agrégé est réutilisable partout — dans d'autres règles, 
d'autres dashboards. Les [alerting rules](https://prometheus.io/docs/prometheus/latest/configuration/alerting_rules/) 
fonctionnent d'ailleurs sur le même principe.

Les règles sont chargées depuis `prometheus.yml` :

```yaml
prometheus.yml                                                                                                                                                     
  global:         
    evaluation_interval: 1m

  rule_files:
    - "rules/*.yml"
```

Un exemple simple : le nombre total de requêtes HTTP par seconde. 

```yaml
groups:                                                                                                                                                              
    - name: http  # doit être unique dans le fichier
      interval: 1m  # optionnel — hérite de global.evaluation_interval sinon                                                                                           
      rules:                                                                                                                                                           
        - record: job:http_requests:rate5m  # convention : <labels>:<métrique>:<opération>                                                                             
          expr: sum by (job) (rate(http_requests_total[5m])) 
```

Au lieu de recalculer ce rate à chaque panel Grafana, Prometheus le fait à interval régulier et stocke le résultat 
dans `job:http_requests:rate5m`.   

Deux choses importantes : 

- Chaque groupe doit avoir un nom unique — Prometheus refuse de démarrer sinon                                                                                       
- La convention de nommage `<labels>:<métrique>:<opération>` n'est pas obligatoire mais rend les règles immédiatement 
lisibles et évite les collisions de noms

Après toute modification des règles, Prometheus doit recharger sa configuration :  

```
curl -X POST http://localhost:9090/-/reload 
```

Avant ça, vérifier la configuration avec promtool pour éviter les mauvaises surprises :     

```
promtool check rules rules/elasticsearch.yml  
   Checking rules/elasticsearch.yml                                                                                                                                     
    SUCCESS: 1 rules found
```

## Mon cas concret

Mes index Elasticsearch suivent une convention de nommage qui contient une info différenciante — par exemple un service
`logs_nginx_2026-05-01`. Je voulais extraire le nom du service pour en faire un label Prometheus et agréger le storage 
par service dans Grafana.

Problème supplémentaire : plusieurs masters exposent les mêmes métriques sur un cluster Elasticsearch. Sans dédupliquer, 
je comptais le storage plusieurs fois.      

La recording rule pour le storage :   

```yaml
groups:
    - name: elasticsearch                                                                                                                                              
      interval: 5m
      rules:                                                                                                                                                           
        - record: es:index:storage:bytes
          expr: >
            min by (service) (
              label_replace(                                                                                                                                           
                elasticsearch_indices_store_size_bytes{role="master", index="logs_*"},
                "service", "$1", "index", ".*-(\\w+)-.*"                                                                                                             
              )                                                                                                                                                        
            )
```

`label_replace` extrait le service du nom de l'index et le pousse dans un label `tenant_id`. Le `min by (tenant_id)` 
déduplique — un seul master par index.             

Deuxième règle pour mesurer la taille moyenne des documents par tenant — en réutilisant la première :      

```yaml
- record: es:index:doc:avg_size:bytes                                                                                                                          
  expr: >                                                                                                                                                      
    es:index:storage:bytes
    /                                                                                                                                                          
    min by (service) (
      label_replace(
        elasticsearch_indices_docs_count{role="master", index="logs_*"},                                                                      
        "service", "$1", "index", ".*-(\\w+)-.*"
      )                                                                                                                                                        
    )     
```

C'est là que la composition devient intéressante : `es:index:storage:bytes` est réutilisé directement. Plus la peine de 
réécrire la logique. 

## Quand ne pas les utiliser

Les recording rules ne sont pas la solution à tout.  
                                                                                                                
Si ta métrique a peu de cardinalité et que tes dashboards chargent vite — pas besoin. Tu ajoutes de la complexité pour 
rien.                  

Si tu es encore en train d'explorer et d'affiner tes queries — pas besoin non plus. Écrire une recording rule trop tôt 
fige quelque chose qui va changer.   

Attention à la cardinalité des labels que tu crées. Chaque combinaison unique de labels est vue comme une série 
distincte par Prometheus. Tu ne résous pas le problème de cardinalité, tu le déplaces. Et ton storage explose.

Enfin, un interval trop court sur une règle lourde et Prometheus passe son temps à évaluer. Pour du capacity planning 
sur 30 jours, 15m est largement suffisant. Le remède devient le problème.

## Ce que je ferais dès le départ

Dès qu'une métrique a beaucoup de cardinalité ou qu'elle sert sur de longues périodes, j'écris une recording rule — pas 
besoin d'attendre que les dashboards rament. 

Si tu monitores un service qui stocke de la data avec de la réplication, pense à la déduplication dès le départ. Les 
masters peuvent exposent les mêmes métriques — sans `min by`, tes agrégations sont fausses.

L'UI Prometheus a une section "Rules" qui affiche le temps d'évaluation de chaque règle. Tu peux aussi les monitorer 
dans Grafana : `prometheus_rule_group_last_duration_seconds > prometheus_rule_group_interval_seconds`

> `prometheus_rule_group_last_duration_seconds` mesure le temps qu'a pris la dernière évaluation du groupe. 
> `prometheus_rule_group_interval_seconds` c'est l'interval configuré. Si le premier dépasse le second, Prometheus n'a 
> pas fini d'évaluer le groupe avant le prochain cycle — tes métriques ne sont plus à jour. C'est le signal que la 
> règle est trop lourde ou que l'interval est trop court.

---

Si tu opères Prometheus en prod, va jeter un oeil à tes métriques à forte cardinalité. Tu as probablement des recording 
rules à écrire sans le savoir.
