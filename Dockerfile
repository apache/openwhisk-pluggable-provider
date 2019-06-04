FROM node:10

# only package.json
ADD package.json /
RUN cd / && npm install --production

# App
ADD provider/. /provider/

EXPOSE 8080

# Run the app
CMD ["/bin/bash", "-c", "node /provider/app.js"]
