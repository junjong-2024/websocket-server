// Port used for the gstreamer process to receive RTP from mediasoup 

const MIN_PORT = 20000;
const MAX_PORT = 29999;
const TIMEOUT = 400;

const takenPortSet = new Set();

export async function getPort() {
  let port = getRandomPort();

  while(takenPortSet.has(port)) {
    port = getRandomPort();
  }

  takenPortSet.add(port);

  return port;
}

export function releasePort(port) { return takenPortSet.delete(port); }

const getRandomPort = () => Math.floor(Math.random() * (MAX_PORT - MIN_PORT) + MIN_PORT); 
