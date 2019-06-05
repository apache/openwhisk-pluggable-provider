FROM node:10

ADD provider /provider

WORKDIR /provider

RUN npm install --production

EXPOSE 8080

CMD "./run.sh"
