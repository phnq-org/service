@phnq/service

The microservices architecture has a lot of benefits, but ease of implemntation isn't one of them. This library aims
to take some of the pain out of getting started with microservices by providing a set of utilities that deals with
most of the basic plumbing.

## Services
The `@phnq/service` library encourages an application to be broken into domain-specific services with no programmatic
interdependencies. What constitues a "domain" is arbitrary, but it is conventionally a group of related handlers, each of
which receives arguments and returns a result. Since these services are programmatically independent, they may be deployed
in separate processes or on distinct machines.

The services within an application are effectively peers, with no inherent limitations in terms of intercommunication. Imposing
encapsulation-oriented communication restrictions is not the purview of this library. Rather, communication is possble between
any two services. 

