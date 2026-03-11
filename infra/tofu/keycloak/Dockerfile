FROM docker.io/opentofu/opentofu:1.8.8

RUN apk add --no-cache bash curl

WORKDIR /workspace

COPY infra/tofu/keycloak /workspace
COPY infra/tofu/keycloak/run-keycloak-config.sh /usr/local/bin/run-keycloak-config.sh

RUN chmod +x /usr/local/bin/run-keycloak-config.sh

ENTRYPOINT ["/usr/local/bin/run-keycloak-config.sh"]
