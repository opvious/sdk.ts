# syntax = docker/dockerfile:1.0-experimental

FROM node:16-alpine

WORKDIR /home/opvious

ARG SERVICE_VERSION

# Avoid storing .npmrc file in intermediate images and image commit history.
# https://docs.docker.com/develop/develop-images/build_enhancements/#new-docker-build-secret-information
RUN --mount=type=secret,id=npmrc,dst=/root/.npmrc npm i @opvious/template-server@$SERVICE_VERSION

USER node
EXPOSE 8080
EXPOSE 50051
CMD ["npm", "--silent", "--offline", "--no-update-notifier", "exec", "@opvious/template-server"]
