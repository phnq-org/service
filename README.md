# @phnq/service

[![CircleCI](https://circleci.com/gh/pgostovic/message.svg?style=svg)](https://circleci.com/gh/pgostovic/service)

[![npm version](https://badge.fury.io/js/%40phnq%2Fservice.svg)](https://badge.fury.io/js/%40phnq%2Fservice)

## Easier Microservices

The pros and cons of microservices as an architectural pattern are an oft debated topic in software engineering circles. One ubiquitously shared opinion is that **ease of implementation** is not in the pros column. The `@phnq/service` library aims to take some of the pain out of getting started with microservices by providing  utilities that deal with the basic plumbing.

#### What are microservices?
> Microservices are a way of breaking up a large application into smaller, more manageable pieces. Each piece is a self-contained service that communicates with other services via a network protocol. The services are typically deployed in separate processes or on distinct machines.
-- GitHub Copilot




## Services
The `@phnq/service` library encourages an application to be broken into domain-specific services with no programmatic
interdependencies. What constitues a "domain" is arbitrary, but it is conventionally a group of related handlers, each of
which receives arguments and returns a result. Since these services are programmatically independent, they may be deployed
in separate processes or on distinct machines.

The services within an application are effectively peers, with no inherent limitations in terms of intercommunication. Imposing
encapsulation-oriented communication restrictions is not the purview of this library. Rather, communication is possble between
any two services. 

