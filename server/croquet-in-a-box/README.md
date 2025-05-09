# Croquet in a Box

All-in-one package of reflector, file server, and web server.

Implemented via Docker Compose to be easily installed on various machines.

## Prerequisites

Docker, Bash

## Run it

    ./croquet-in-a-box.sh

then go to http://localhost:8888/ and try the examples.

The apps on that page use a `box` parameter in `Session.join()` instead of an API key. They don't connect to the public reflectors but to this box. In there, `box=/` is equivalent to `box=http://localhost:8888/` which in turn is equivalent to  `reflector=ws://localhost:8888/reflector&files=http://localhost:8888/files` (Croquet clients before 2.0.0 needed the latter, since then the `box` shortcut works).

Substitute your external IP address for `localhost` to be able to join from other devices.

You can override the default port number and location of the webroot and files:

    ./croquet-in-a-box.sh <port> <webroot dir> <files dir>

## What it does

As defined in the `docker-compose.yml` file it runs two docker images – one for the reflector, and one nginx image for the webserver/fileserver and reflector proxy.

On [localhost:8888](http://localhost:8888/) is the web server (serving `./webroot`),
[localhost:8888/files](http://localhost:8888/files/) is the file server (upload and download to `./files`), and [localhost:8888/reflector](http://localhost:8888/reflector) is the reflector.
