+++
date = '2025-03-31T21:44:03+02:00'
tags = ['Terraform', 'macos']
title = 'How to Fix Missing Terraform Darwin ARM64 Binary Issues'
+++

Sometimes you need to work with an older version of Terraform but there is no existing Darwin ARM64 binary for the version you need. Even if you’re using version managers like [tfenv](https://github.com/tfutils/tfenv) or [asdf](https://asdf-vm.com/), you might find that the correct binary architecture is missing for the version you're looking for. This is common for versions created before Mac processor architecture was released.

Here a quick workaround solution to fix this situation :

1. Install go :

```
brew install go
```

2. Clone the Terraform repository :

```
git clone https://github.com/hashicorp/terraform
```

3. Checkout the required version of Terraform :

```
cd terraform
git checkout tags/v0.12.13
```

4. Build an executable file :

```
go install .
```

5. The previous `go` command build a binary in your `GOBIN` by default. Ensure it is present in your `PATH` :

```
export PATH="$PATH:$(go env GOBIN)"
```

