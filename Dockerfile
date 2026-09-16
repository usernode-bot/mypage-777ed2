FROM node:22-alpine
WORKDIR /app
COPY --chown=1000:1000 package.json ./
RUN npm install --production
COPY --chown=1000:1000 . .
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1
# Kubernetes enforces runAsNonRoot without supplying a UID, so this has to be
# numeric: unlike a symbolic USER, it lets the kubelet verify the image before
# startup. Matches the platform app template (#2284).
USER 1000:1000
CMD ["node", "server.js"]
