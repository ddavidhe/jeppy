# Jeppy

A real-time multiplayer Jeopardy-style trivia game built with Node.js, Express, and WebSockets.

## Features

- **Create & Join Rooms** – Host creates a room and shares a 4-character code with players
- **Real-time Gameplay** – WebSocket-powered live updates for all players
- **Buzz-in System** – Players race to buzz in and answer questions
- **Host Controls** – Host selects questions and judges answers (correct/incorrect/skip)
- **Live Scoreboard** – Scores update in real-time with support for negative scores
- **5 Categories** – Science, History, Geography, Pop Culture, and Sports (5 questions each)

## Prerequisites

- [Node.js](https://nodejs.org/) (v14 or higher recommended)
- npm (comes with Node.js)

## Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/davidhe/jeppy.git
   cd jeppy
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

## Running Locally

Start the server:
```bash
npm start
```

The app will be available at **http://localhost:3000**

## How to Play

1. **Host** enters their name and clicks **Create Room**
2. Share the 4-character room code with other players
3. **Players** enter their name and the room code to join
4. Once everyone has joined, the host clicks **Start Game**
5. The host selects questions from the board
6. Players buzz in to answer – the host judges if the answer is correct or incorrect
7. Game ends when all 25 questions have been answered

## Project Structure

```
jeppy/
├── server.js          # Express + WebSocket server
├── package.json       # Dependencies and scripts
├── public/
│   ├── index.html     # Main HTML structure
│   ├── app.js         # Client-side WebSocket logic
│   └── style.css      # Styling
└── README.md
```

## License

MIT