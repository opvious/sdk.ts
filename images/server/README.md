# Server Docker image

To build the image locally:

```sh
DOCKER_BUILDKIT=1 docker build . \
  --secret id=npmrc,src=$HOME/.npmrc \
  --build-arg SERVICE_VERSION=latest \
  -t template-server
```
