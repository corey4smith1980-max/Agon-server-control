FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev
COPY server.mjs ./server.mjs
RUN mkdir -p /data && chown -R node:node /data /app
USER node
ENV PORT=8787 DATA_DIR=/data
EXPOSE 8787
VOLUME ["/data"]
CMD ["node", "server.mjs"]
