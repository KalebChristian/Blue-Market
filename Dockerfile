FROM node:24-bookworm-slim
WORKDIR /app
COPY --chown=node:node server.js package.json ./
COPY --chown=node:node public ./public
RUN mkdir /data && chown node:node /data
ENV BLUE_DATA=/data
USER node
EXPOSE 3000
CMD ["node","server.js"]
