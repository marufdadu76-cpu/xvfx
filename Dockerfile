FROM node:18-alpine

RUN apk add --no-cache ghostscript imagemagick

WORKDIR /app
COPY package*.json ./
RUN npm install --production
COPY . .

EXPOSE 8080
CMD ["node", "server.js"]
