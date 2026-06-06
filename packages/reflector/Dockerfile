FROM node:22-alpine
ARG LABEL=bland
WORKDIR /usr/src/reflector
COPY package*.json localfs.js reflector.js .pino-prettyrc ./
RUN npm ci
ENV LOG_LEVEL=info
ENV CLUSTER_LABEL=$LABEL
ENV FILES_MOUNT_PATH=/var/croquet-files
EXPOSE 9090
CMD [ "npm", "start" ]
