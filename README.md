# @phnq/service

[![npm version](https://badge.fury.io/js/%40phnq%2Fservice.svg)](https://badge.fury.io/js/%40phnq%2Fservice)

> TL;DR - jump to [Getting Started](#getting-started) for a barebones example.

## Microservices Made Easy

The pros and cons of microservices as an architectural pattern are an oft debated topic in software engineering circles. One ubiquitously shared opinion is that **ease of implementation** is not in the pros column. The `@phnq/service` library aims to take some of the pain out of getting started with microservices by providing  utilities that deal with the basic plumbing. There are plenty of other benefits too such as end-to-end type safety as scalability.

#### What are microservices?
> Microservices are a way of breaking up a large application into smaller, more manageable pieces. Each piece is a self-contained service that communicates with other services via a network protocol. The services are typically deployed in separate processes or on distinct machines.
-- GitHub Copilot

But lets just call them `services`.

## Features
- **Ease of use** - the power to weight ratio is high, meaning you can do a lot with very little code.
- **Type safety** - end-to-end type safety throughout the system, from backend to frontend, services, clients, etc.
- **Performance** - internal communication with pub/sub ([NATS](https://nats.io/)) means very few bottlenecks. The included WebSocket API service is also very performant.
- **Scalability** - services can be deployed in separate processes or on distinct machines. Automatic load balancing between multiple instances of a service.
- **Flexibility** - services can be deployed separately, together, or in any combination. This makes local development easy because a production environment replica is not necessary.

## Overview
Before we get into the details, here's a quick overview of the basic moving parts and actors in @phnq/service.

### Service

A service is really quite simple. It is merely a collection of handlers associated with a domain.
- `handler` - a named function that receieves a single argument (the payload) and returns some result.
- `domain` - a string that identifies the service.

If this sounds like a web server, that's because it's more or less the same thing semantically. It's different under the hood, but the idea is the same. A service is a server that handles requests.

### Service Client

A service client provides a way to interact with a service. A service client is also associated with a domain, but instead of handling requests, it makes requests to a service with the same domain name. A service client's programmatic API methods are named after the handlers of the service it interacts with.

### Web Server/REST API Integration

Service clients can be used within a web server application like an Express app. Side requests can be made to services while the HTTP server handles requests.

![Alt text](images/rest.png)

### API Service (WebSocket)

An alternative architecture to the traditional web server one involves having all API communication happen over a WebSocket. In this case, the service clients can be used in a web browser. This architecture has many advantages which will be outlined below.

![Alt text](images/ws.png)

> **Note:** there is an `ApiService` utility included in `@phnq/service`.

## Getting Started

Here's a barebones example of how to use `@phnq/service` to create a service and a client for that service.

#### Run NATS
You will need a [NATS](https://nats.io/) server running. You can run one locally with Docker:
```
docker run nats
```

#### Create an API interface

This interface will be used by both the service and the client.

```ts
interface GreetingsApi {
  greet: (name: string) => Promise<string>;
}
```

#### Create a Service

Use the interface created above to define the service's handlers.

```ts
import { Service } from "@phnq/service";

const greetingsService = new Service<GreetingsApi>('greetings', {
  handlers: {
    greet: async (name: string) => {
      return `Hello, ${name}!`;
    },
  },
});

await greetingsService.connect();
```
> **Note**: the last statement should be wrapped in an async function unless you're using Bun which supports top-level await.

#### Create a Service Client

Use the same interface again to create a client for the service.

```ts
import { ServiceClient } from "@phnq/service";

const greetingsClient = ServiceClient.create<GreetingsApi>('greetings');

const greeting = await greetingsClient.greet('World'); // Hello, World!
```

That's it for a very basic example of inter-service communication. Next we'll look at how to communictate with a service from a web browser over a WebSocket.

#### Use the ApiService to create a WebSocket server

The `ApiService` is a WebSocket server that acts as a gateway or proxy to your services from a web browser.

```ts
import { ApiService } from '@phnq/service';

const apiService = new ApiService({ port: 5555 } );

await apiService.start();
```

> **Note**: Again, the last statement should be wrapped in an async function unless you're using Bun which supports top-level await.


It's a bit magical in that it is semantically isolated from the rest of the system. This is convenient for scalability; you can have as many of these as you want behind a load balancer.


#### Create an ApiClient

This is similar to the [ServiceClient](#create-a-service-client) we created above but you can use it in a web browser. The same GreetingsApi interface is used again.

```ts
import { ApiClient } from '@phnq/service/browser';

const greetingsClient = ApiClient.create<GreetingsApi>('greetings', 'ws://localhost:5555');

const greeting = await greetingsClient.greet('World'); // Hello, World!
```

## WebSocket vs REST
It's a bit surprising that WebSockets are not more widely used for frontend/backend API communication. Presumably, this is because WebSockets are so low-level that you have to build a lot of infrastructure around them to make them useful; you basically have to invent your own protocol. However, the performance benefits are undeniable, making the dearth of WebSocket-based API utilities all the more remarkable.

### Request/Response
The semantics of request/response are really useful; the client wants something and asks for it, then the server responds in kind. This is how the web works, and it's how most APIs work. REST (via HTTP) has this built right in to the protocol.

WebSockets, on the other hand, don't do request/response by default, but it's totally possible to build a request/response protocol on top of WebSockets. This is what `@phnq/service` does.

### The HTTP Bottleneck

The problem with HTTP servers is that every client/server interaction uses a TCP connection. This isn't such big deal when responses are quick. But suppose you have a really slow response (maybe a slow database query or something) that takes, say, 20 seconds. The TCP connection is tied up for these 20 seconds, even though it's doing nothing; the web browser will have to use another connection to make another request. Web browsers typically have a limit of 6 connections per domain, so if you have a lot of slow requests and the browser reaches this limit, the 7th will have to wait for one of the previous requests to complete. Even if responses are quick, the TCP connection is still tied up for the duration of the request/response cycle. This response latency adds up, reducing the overall throughput of the web server.

### How WebSockets Solve the Problem

WebSockets are bi-directional (or full-duplex), meaning that communication can be initiated from either the client or the server. When a client sends a message to a WebSocket server, the connection is immediately freed up to do other things. The server can eventually "respond" by sending a message to the client. The slow response scenario is not a communication bottleneck because the connection is only being used when messages are being sent. If the client makes 100 requests that each take 20 seconds to respond, the 100 responses will all come back in 20 seconds, only using a single TCP connection. The same scenario with an HTTP server would take over 5 minutes, occupying 6 connections the whole time!

## Usage
TBD




<!-- The `@phnq/service` library encourages an application to be broken into domain-specific services with no programmatic
interdependencies. What constitues a "domain" is arbitrary, but it is conventionally a group of related handlers, each of
which receives arguments and returns a result. Since these services are programmatically independent, they may be deployed
in separate processes or on distinct machines.

The services within an application are effectively peers, with no inherent limitations in terms of intercommunication. Imposing
encapsulation-oriented communication restrictions is not the purview of this library. Rather, communication is possble between
any two services. 
 -->
