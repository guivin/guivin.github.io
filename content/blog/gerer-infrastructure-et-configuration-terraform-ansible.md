---
title: "Gérer l'infrastructure et la configuration ensemble : Terraform rencontre Ansible"
date: 2025-05-21T19:13:00+02:00
tags:
  - terraform
  - ansible
  - iac
---

Terraform excelle dans le provisionnement de l'infrastructure. Ansible excelle dans sa configuration. Ensemble, ils couvrent tout le spectre de l'automatisation — mais les intégrations traditionnelles via `local-exec` peuvent vite devenir complexes et difficiles à faire évoluer.

C'est là qu'intervient le Terraform Ansible Provider : une façon plus propre et plus fluide de connecter les deux outils.

Dans cet article, nous allons déployer un serveur NGINX sur DigitalOcean en utilisant ce provider — en unifiant le provisionnement de l'infrastructure et sa configuration dans un seul workflow.

## Prérequis

* [Terraform](https://developer.hashicorp.com/terraform/tutorials/aws-get-started/install-cli)
* [Ansible](https://docs.ansible.com/ansible/latest/installation_guide/intro_installation.html)
* Un compte DigitalOcean avec un [token configuré](https://docs.digitalocean.com/reference/api/create-personal-access-token/)

Installer la collection Ansible `cloud.terraform` :

```
ansible-galaxy collection install cloud.terraform
```

## Relier Terraform et Ansible : la configuration de l'inventaire simplifiée

Le plugin `cloud.terraform.terraform_provider` fait le pont entre Terraform et Ansible en permettant à Ansible d'interagir directement avec l'infrastructure définie dans votre état Terraform. Cette intégration garantit la cohérence entre les deux outils en générant dynamiquement un inventaire Ansible à partir de l'état Terraform courant.

Voici à quoi ressemble le fichier `inventory.yml` :

```yaml
---
plugin: cloud.terraform.terraform_provider
```

## Écriture du code Terraform

La configuration Terraform suivante provisionne une infrastructure sur DigitalOcean et l'intègre directement avec Ansible via le Terraform Ansible provider. Elle définit :
* Les providers Terraform requis (DigitalOcean et Ansible)
* Un Droplet provisionné via l'API DigitalOcean
* Une entrée d'inventaire Ansible pour le Droplet, directement depuis l'état Terraform

```hcl
terraform {
  required_providers {
    ansible = {
      source  = "ansible/ansible"
      version = "1.3.0"
    }

    digitalocean = {
      source  = "digitalocean/digitalocean"
      version = "2.45.0"
    }
  }
}

variable "do_token" {
  description = "Token to authenticate to DigitalOcean"
  type        = string
  sensitive   = true
}

resource "digitalocean_ssh_key" "default" {
  name       = "Terraform Example"
  public_key = file(pathexpand("~/.ssh/id_rsa.pub"))
}

resource "digitalocean_droplet" "web1" {
  name     = "web1"
  image    = "ubuntu-24-10-x64"
  region   = "nyc2"
  size     = "s-1vcpu-1gb"
  backups  = false
  ssh_keys = [digitalocean_ssh_key.default.fingerprint]
}

resource "ansible_host" "web1" {
  name   = digitalocean_droplet.web1.ipv4_address
  groups = ["webservers"]
  variables = {
    ansible_user                 = "root"
    ansible_ssh_private_key_file = "~/.ssh/id_rsa"
    ansible_python_interpreter   = "/usr/bin/python3"
    ansible_ssh_common_args      = "-o StrictHostKeyChecking=no"
  }
}

output "ipv4_address" {
  value = digitalocean_droplet.web1.ipv4_address
}
```

* Configuration des providers : le bloc `required_providers` déclare les dépendances sur les providers `ansible` et `digitalocean` avec un versionnage explicite pour la reproductibilité.
* Token API : la variable `do_token` est marquée comme sensible, assurant un traitement sécurisé des credentials DigitalOcean.
* Configuration SSH : votre clé publique SSH locale est uploadée sur DigitalOcean, permettant l'accès SSH au nouveau droplet.
* Provisionnement du Droplet : un unique Droplet `web1` est créé avec Ubuntu 24.10 dans la région NYC2 avec un petit type d'instance.
* Ressource d'inventaire Ansible : la ressource `ansible_host` mappe dynamiquement l'IP du Droplet dans un inventaire Ansible, garantissant que la gestion de configuration est directement alignée avec l'état Terraform.
* Output IP : affiche l'IP du serveur provisionné après un apply réussi, pour se connecter ou vérifier facilement.

Appliquer le code Terraform avec votre token DigitalOcean :

```
$ read -s DO_TOKEN
$ terraform apply -var "do_token=$DO_TOKEN"
```

## Visualiser l'inventaire dynamique Ansible généré par Terraform

Après avoir provisionné votre infrastructure et généré l'inventaire Ansible via Terraform, vous pouvez visualiser sa structure et les variables associées avec cette commande :

```
$ ansible-inventory -i inventory.yml --graph --vars
```

## Ce que vous voyez expliqué

* `@all` : représente tous les hôtes définis dans l'inventaire.
* `@ungrouped` : hôtes qui ne sont affectés à aucun groupe spécifique.
* `@webservers` : ce groupe inclut tous les hôtes étiquetés "webservers".

Sous le groupe `@webservers`, l'hôte 162.243.103.221 a plusieurs variables attachées :

* `ansible_python_interpreter = /usr/bin/python3` : chemin vers l'interpréteur Python sur la machine cible.
* `ansible_ssh_common_args = -o StrictHostKeyChecking=no` : option SSH pour ignorer la vérification de la clé d'hôte lors de la connexion.
* `ansible_ssh_private_key_file = ~/.ssh/id_rsa` : chemin vers la clé privée SSH utilisée pour l'authentification.
* `ansible_user = root` : utilisateur avec lequel se connecter en SSH.

## Pourquoi c'est utile

Cette sortie graphique vous aide à :
* Comprendre la structure de votre inventaire d'un coup d'œil.
* Vérifier que toutes les variables nécessaires sont correctement définies sur chaque hôte.
* Déboguer et revoir votre configuration Ansible avant d'exécuter les playbooks.

## Appliquer le playbook Ansible avec l'inventaire généré par Terraform

Une fois l'infrastructure provisionnée et l'inventaire dynamique prêt, vous pouvez exécuter votre playbook Ansible directement en utilisant le fichier `inventory.yml` généré par Terraform :

```
ansible-playbook playbook.yml -i inventory.yml
```

Cette commande exécute le playbook sur l'infrastructure provisionnée. Dans cet exemple, le playbook :

1. Collecte les facts sur l'hôte cible.
2. Installe le paquet NGINX s'il n'est pas déjà présent.
3. S'assure que le service NGINX est démarré et activé au démarrage.

### Exemples de sorties

```
PLAY [Webservers] *************************************************************************************************

TASK [Gathering Facts] ********************************************************************************************
ok: [162.243.103.221]

TASK [Ensure NGINX package is present.] ***************************************************************************
changed: [162.243.103.221]

TASK [Ensure NGINX is started and enabled.] ***********************************************************************
ok: [162.243.103.221]

PLAY RECAP ********************************************************************************************************
162.243.103.221            : ok=3    changed=1    unreachable=0    failed=0    skipped=0    rescued=0    ignored=0
```

### Vérifier le déploiement

Vous pouvez vous connecter en SSH au serveur et vérifier que NGINX fonctionne correctement :

```
HOSTNAME=$(terraform output -json | jq -r .ipv4_address.value)
ssh root@$HOSTNAME
```

Une fois connecté :

```
systemctl status nginx
```

### Exemple de sortie de statut :

```
● nginx.service - A high performance web server and a reverse proxy server
     Loaded: loaded (/usr/lib/systemd/system/nginx.service; enabled; preset: enabled)
     Active: active (running) since Wed 2024-12-04 10:51:51 UTC; 1min 29s ago
   Main PID: 2441 (nginx)
      Tasks: 2 (limit: 1110)
     Memory: 2.1M (peak: 2.3M)
        CPU: 26ms
     CGroup: /system.slice/nginx.service
             ├─2441 "nginx: master process /usr/sbin/nginx -g daemon on; master_process on;"
             └─2442 "nginx: worker process"
```

Cela confirme que votre playbook a été appliqué avec succès et que le service NGINX fonctionne sur votre serveur nouvellement provisionné.

## Conclusion

Dans cet article, nous avons exploré comment intégrer de manière fluide Terraform et Ansible via le Terraform Ansible provider pour automatiser à la fois le provisionnement de l'infrastructure et la gestion de la configuration.

En tirant parti de cette intégration :

* Terraform s'occupe de créer les ressources cloud (VMs, réseaux, etc.)
* Ansible gère la configuration de ces ressources (installation de paquets, démarrage de services, etc.)
* Le Terraform Ansible provider fait le pont, en générant automatiquement des inventaires dynamiques depuis l'état Terraform

Cette approche élimine le besoin de gestion manuelle des inventaires et garantit la cohérence entre provisionnement et configuration.

Le code complet est sur GitHub :
[terraform-ansible-integration-101](https://github.com/guivin/terraform-ansible-integration-101)
