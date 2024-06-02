import { Readable } from 'stream';

// Converts a string (SDP) to a stream so it can be piped into the FFmpeg process
export function convertStringToStream(stringToConvert) {
  const stream = new Readable();
  stream._read = () => {};
  stream.push(stringToConvert);
  stream.push(null);

  return stream;
}

// Gets codec information from rtpParameters
export function getCodecInfoFromRtpParameters(kind, rtpParameters) {
  return {
    payloadType: rtpParameters.codecs[0].payloadType,
    codecName: rtpParameters.codecs[0].mimeType.replace(`${kind}/`, ''),
    clockRate: rtpParameters.codecs[0].clockRate,
    channels: kind === 'audio' ? rtpParameters.codecs[0].channels : undefined
  };
}

export function makeid(length) {
  let result = '';
  const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const charactersLength = characters.length;
  let counter = 0;
  while (counter < length) {
    result += characters.charAt(Math.floor(Math.random() * charactersLength));
    counter += 1;
  }
  return result;
}