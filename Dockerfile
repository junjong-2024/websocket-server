FROM node:22-bookworm

WORKDIR /app
RUN apt-get update \
    && apt-get install -y ffmpeg python3 python3-pip
COPY package-lock.json .
COPY package.json .
RUN npm install --force

COPY src src
COPY ssl ssl
COPY public public

EXPOSE 3016
EXPOSE 10000-20000

RUN npm i -g nodemon

CMD npm start
