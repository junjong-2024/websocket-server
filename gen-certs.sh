#!/usr/bin/env bash

cert=crt.pem
certPk=pk.pem
ca=ca.crt.pem
caPk=ca.pk.pem

host=localhost
certValidityDays=30

rm -rf ./ssl/*
cd ssl

# Create CA
openssl req -newkey rsa:4096 -keyout "${caPk}" -x509 -new -nodes -out "${ca}" \
  -subj "/OU=Unknown/O=Unknown/L=Unknown/ST=unknown/C=AU" -days "${certValidityDays}"

# Create Cert Signing Request
openssl req -new -newkey rsa:4096 -nodes -keyout "${certPk}" -out csr.pem \
       -subj "/CN=${host}/OU=Unknown/O=Unknown/L=Unknown/ST=unknown/C=AU" 

# Sign Cert
openssl x509 -req -in csr.pem -CA "${ca}" -CAkey "${caPk}" -CAcreateserial -out "${cert}" \
       -days "${certValidityDays}"

cp pk.pem privkey.pem
cp crt.pem fullchain.pem