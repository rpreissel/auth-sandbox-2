FROM docker.io/maven:3.9.9-eclipse-temurin-21 AS builder

WORKDIR /workspace
COPY keycloak-extension /workspace
RUN mvn -q package

FROM quay.io/keycloak/keycloak:26.5.5

COPY --from=builder /workspace/target/auth-sandbox-2-keycloak-extension-0.1.0.jar /opt/keycloak/providers/auth-sandbox-2-keycloak-extension.jar

USER keycloak
RUN /opt/keycloak/bin/kc.sh build
