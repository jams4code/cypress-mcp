// @cypress/grep 5+ exports register; 4.x exports the function itself.
const grep = require("@cypress/grep");
(grep.register ?? grep)();
