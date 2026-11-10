# MP3 encoder

This project uses LAME (https://lame.sourceforge.net/) through Alex Zhukov's
[lamejs 1.2.1](https://github.com/zhuker/lamejs), licensed under the GNU Lesser
General Public License version 3. The encoder is a separate, replaceable script.
No changes were made to its code. There are no runtime downloads from third-party
servers and audio never leaves the browser for encoding.

`lamejs-1.2.1/lame.min.js` is the original browser bundle from the `lamejs@1.2.1`
package. `lamejs-1.2.1/lame.all.js` is the matching unminified source bundle.
The package's original `LICENSE` notice and the full GNU Lesser General Public
License version 3 and GNU General Public License version 3 texts are included.
The upstream package, including modular source and build scripts, is available
at https://registry.npmjs.org/lamejs/-/lamejs-1.2.1.tgz.

Package SHA-1: `0f92d38729213f106d4a19ded20821da7e89c8e4`.

`lame.min.js` SHA-256:
`15d285e2587b3bdbfd18a68de6ce07cc074f7480a82c3815da2dc1c348ec6df4`.

To replace or modify the encoder, replace the separate bundle while retaining
its `lamejs.Mp3Encoder` interface, then run `node tests/mp3_test.js`.
The application does not restrict modification or reverse engineering of the
encoder for debugging such modifications.
