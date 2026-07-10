// File khoi dong cho HawkHost (cPanel Node.js App / Phusion Passenger)
// Passenger se tu cap PORT qua bien moi truong.
const http = require("http");
const next = require("next");

const port = process.env.PORT || 3000;
const app = next({ dev: false });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  http.createServer((req, res) => handle(req, res)).listen(port, () => {
    console.log("Minh Ky EV dang chay tren cong " + port);
  });
});
