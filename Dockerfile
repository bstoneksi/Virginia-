# Virginia - single-service deploy (API + static client). Mount a Railway volume at /data.
FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --include=dev
COPY . .
RUN npm run build
ENV DATA_DIR=/data
EXPOSE 3000
CMD ["npm", "start"]
