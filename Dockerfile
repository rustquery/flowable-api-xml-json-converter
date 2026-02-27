FROM node:24-slim AS builder
WORKDIR /app

COPY package*.json ./
RUN npm install
COPY . .

FROM node:24-slim
WORKDIR /app
COPY --from=builder /app ./
EXPOSE 3111
CMD ["npm", "start"]
