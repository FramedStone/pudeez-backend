# Pudeez Backend 

This backend powers the Pudeez marketplace, handling user auth (zkLogin), product listing, auctions, escrow, and real-time notifications.

## Tech Stacks & SDK
- Node.js
- Express + Axios
- Socket.IO
- Sui zkLogin SDK
- Sui TypeScript SDK
- Walrus 
- Running on Sui Devnet

## TODO
- [ ] TypeScript, ESLint, Prettier setup
- [ ] Business Logic setup
  - [ ] Steam game assets tokenizing
    - [ ] using their own Steam Web API key? (only if needed)
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
- [ ] environment setup & environment template
- [ ] proper README.md
