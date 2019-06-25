Copyright © 2019 Croquet Studios

Croquet guarantees that the same sequence of random numbers is generated within the model on each client.
If you call `Math.random()` within the model it will return the same number on all clients.

Calls to `Math.random()` within the view will behave normally. Different clients will receive different random numbers.