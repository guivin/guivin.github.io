---
title: "Comment résoudre les problèmes de binaire Terraform Darwin ARM64 manquant"
date: 2025-03-31T21:44:03+02:00
tags:
  - terraform
  - macos
---

Parfois vous avez besoin de travailler avec une ancienne version de Terraform, mais il n'existe pas de binaire Darwin ARM64 pour la version dont vous avez besoin. Même en utilisant des gestionnaires de versions comme [tfenv](https://github.com/tfutils/tfenv) ou [asdf](https://asdf-vm.com/), il se peut que l'architecture de binaire correcte soit absente pour la version recherchée. C'est courant pour les versions créées avant la sortie de l'architecture processeur Apple Silicon.

Voici une solution de contournement rapide pour résoudre cette situation :

1. Installer go :

```
brew install go
```

2. Cloner le dépôt Terraform :

```
git clone https://github.com/hashicorp/terraform
```

3. Checkout la version requise de Terraform :

```
cd terraform
git checkout tags/v0.12.13
```

4. Compiler un exécutable :

```
go install .
```

5. La commande `go` précédente compile un binaire dans votre `GOBIN` par défaut. Assurez-vous qu'il est présent dans votre `PATH` :

```
export PATH="$PATH:$(go env GOBIN)"
```
