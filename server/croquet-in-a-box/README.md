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

## Session and Persistent Data

This implementation supports saving session and persistent data onto the local disk, instead of Google buckets.

It requires some configuration to satisfy the following.

- The two docker containers, one running the reflector and another running nginx should share the same user and group id for processes that access the files in the  host environment.
- The nginx server can be the public visible server. That is it might serve port 80, and upgrade access to /reflector to websocket, as well as handling the PUT requires. But we also want to support the case where an existing server (it may not even be nginx) handles the public visbile requests and reverse proxy them to the containers.

To do so, first you add a user and group that are both called "reflector"

  # addgroup --system reflector
  # adduser --system reflector -ingroup reflector

  # mkdir _files
  # sudo chown reflector:reflector _files

Then run `./build.sh`. You can run this script as a non-priviliged user
if you run `sudo usermod -aG docker ${USER}` to allow the access to
the docker daemon socket from this user.

After inspecting created images, you can run `./compose.sh up -d`. As
you can see in `compose.sh`, it simply sets up the environment
variables and call `docker compose` with the rest of arguments. Some
convenient commands include `./compose.sh logs`, `./compose.sh down`,
etc.
