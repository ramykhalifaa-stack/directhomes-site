FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src
COPY templates ./templates
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 DATABASE_FILE=/data/platform.db
VOLUME /data
USER node
EXPOSE 3000
CMD ["npm", "start"]
