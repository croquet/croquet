Most people do not have to modify their network or firewall settings to use any product released by Croquet, including Croquet OS, Croquet for Unity, Microverse World Builder, or Metaverse Web Showcase.

However, if you are on a network behind a firewall with a strict set of rules, you may have to make some changes to your firewall configuration.

An app built with Croquet OS will make network connections to the Croquet infrastructure with the following parameters:

| Parameter    | Data                                                                                                        |
|--------------|-------------------------------------------------------------------------------------------------------------|
| Domain       | `croquet.io` (and subdomains)                                                                               |
| Hosts        | `croquet.io`, `api.croquet.io`, `files.us.croquet.io`, `files.eu.croquet.io`, `files.*.croquet.io` (future) |
| IP Addresses | `34.102.167.79`                                                                                             |
| Port         | `443`                                                                                                       |
| Protocols    | `https`, `wss`                                                                                              |
| HTTP Methods | `GET`, `HEAD`, `PUT`, `OPTIONS`, `UPGRADE`                                                                  |
| HTTP Headers | `x-croquet-app`, `x-croquet-auth`, `x-croquet-id`, `x-croquet-session`, `x-croquet-version`                 |

We last updated this information on 2023-04-26.

---

Copyright © 2023 Croquet Corporation
