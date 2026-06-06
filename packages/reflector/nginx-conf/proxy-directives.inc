proxy_http_version 1.1;   # NginX versions before 1.29.7 default to 1.0
# proxy_ssl_session_reuse on;

# sends the host the client asked for
proxy_set_header Host $host;

proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
proxy_set_header X-Forwarded-Proto $scheme;
proxy_set_header X-Forwarded-SSL "";
proxy_set_header X-Forwarded-Scheme "";
proxy_set_header X-Forwarded-Host "";

#proxy_hide_header Foo
