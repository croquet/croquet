# Croquet in a Box

All-in-one package of reflector, file server, and web server.

Implemented via Docker Compose to be easily installed on various machines.

This `files` branch added a way to save snapshots, persistent data and uploaded contents into the local directory. You can run it on a local computer or a Linux instance on the net.

## Prerequisites

Docker, Bash

## Session and Persistent Data

This implementation supports saving session and persistent data onto the local disk, instead of Google buckets.

It requires some configuration to satisfy the following.

To run it locally, there is not much more to do. run `./build.sh` to create docker images, and run `./compose.sh up -d`.

If you want to run it on a server, it is recommended to set file permissions and ownwers.

- The two docker containers, one running the reflector and another running nginx should share the same user and group id for processes that access the files in the  host environment.
- The nginx server can be the public visible server. That is it might serve port 80, and upgrade access to /reflector to websocket, as well as handling the PUT requires. But we also want to support the case where an existing server (it may not even be nginx) handles the public visbile requests and reverse proxy them to the containers.

To do so, first you add a user and group that are both called "reflector"

  `# addgroup --system reflector`

`# adduser --system reflector -ingroup reflector`

  `# mkdir _files`

`# sudo chown reflector:reflector _files`

Then run `./build.sh`. You can run this script as a non-priviliged user
if you run `sudo usermod -aG docker ${USER}` to allow the access to
the docker daemon socket from this user.

After inspecting created images, you can run `./compose.sh up -d`. As
you can see in `compose.sh`, it simply sets up the environment
variables and call `docker compose` with the rest of arguments. Some
convenient commands include `./compose.sh logs`, `./compose.sh down`,
etc.
