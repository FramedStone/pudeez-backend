# Pudeez Backend 

This backend powers the Pudeez marketplace, handling user auth (zkLogin), product listing, auctions, escrow, and real-time notifications.

## Tech Stacks & SDK
- Node.js
- Express + Axios
- Socket.IO
- Sui zkLogin SDK
- Sui TypeScript SDK
- Walrus 

## TODO
- [ ] TypeScript, ESLint, Prettier setup
- [ ] Business Logic setup
  - [ ] Steam game assets tokenizing
  - [ ] Escrow process
  - [ ] Marketplace Profit Mechanism
- [ ] Auth: zkLogin integration, JWT
  - [ ] bind with Steam openID
- [ ] Marketplace logic: list, buy/sell, auctions
- [ ] Blockchain integration
  - [ ] Move packages testing
- [ ] Walrus integration
  - [ ] Web API
  - [ ] JSON API
- [ ] Websocket integration for notification system
- [ ] Background workers: Job/Request Queuer
- [ ] Unit & integration tests
- [ ] ElizaOS integration
  - [ ] As chatbot - marketplace knowledge
  - [ ] As agent - marketplace actions
- [ ] proper README.md
