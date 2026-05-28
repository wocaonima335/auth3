FROM node:24-alpine

WORKDIR /app
COPY . .

CMD ["node", "apps/worker/src/worker.js"]
