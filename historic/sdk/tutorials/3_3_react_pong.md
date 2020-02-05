Copyright © 2019 Croquet Studios

In this tutorial, we'll implement a simple multiplayer pong game. We will use the same technique as in the "Hello React" tutorial - a singular model containing all state - only that that model is now a lot more complex, containing and simulating the whole game state of Pong.

We will also use several view components to delegate rendering the different game elements, but we will use a simple model of interaction between them and the Croquet model state, where only the top-level `PlayingField` component deals with Croquet interaction and simply passes the (live-updating) data from the model down to it's child components as parameters. This pattern of one smart high-level component that passes information down to "dumb" child components is quite idiomatic for React, but stops being convenient for even more complex apps. What to do in this case, we'll explore in the next tutorial.

<iframe
     src="https://codesandbox.io/embed/react-croquet-pong-hifx9?fontsize=14&module=%2Findex.jsx&theme=light"
     style="width:100%; height:500px; border:0; border-radius: 4px; overflow:hidden;"
     title="react croquet pong"
     allow="geolocation; microphone; camera; midi; vr; accelerometer; gyroscope; payment; ambient-light-sensor; encrypted-media; usb"
     sandbox="allow-modals allow-forms allow-popups allow-scripts allow-same-origin"
   ></iframe>

   TODO: walkthrough