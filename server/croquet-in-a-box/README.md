# Croquet in a Box

All-in-one package of reflector, file server, and web server.

Implemented via Docker Compose to be easily installed on various machines.

## Prerequisites

Git, Node, Docker (https://www.docker.com), Bash

## Run it

    ./croquet-in-a-box.sh

then go to http://localhost:8888/multiblaster/?box=/

The `box=/` argument is equivalent to `box=http://localhost:8888/` which in turn is equivalent to  `reflector=ws://localhost:8888/reflector&files=http://localhost:8888/files/` (Croquet clients before 2.0.0-43 needed the latter, since then the `box` shortcut works).

Substitute your external IP address for `localhost` to be able to join from other devices.

## What it does

As defined in the `docker-compose.yml` file it runs two docker images – one for the reflector, and one for the webserver/fileserver.

On [localhost:8888](http://localhost:8888/) is the web server (serving the files in `../../website`),
[localhost:8888/files](http://localhost:8888/files/) is the file server (upload and download), and [localhost:8888/reflector](http://localhost:8888/reflector) is the reflector.
