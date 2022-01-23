const Fs = require('fs-extra')
const Path = require('path')

const filesToCopy = [
    // from location             // to location
    ['target/idl/gem_bank.json', 'anchor/idl/gem_bank.json'],
    ['target/idl/gem_farm.json', 'anchor/idl/gem_farm.json'],

    // types
    ['target/types/gem_bank.ts', 'anchor/types/gem_bank.ts'],
    ['target/types/gem_farm.ts', 'anchor/types/gem_farm.ts'],
]

function copy() {
    filesToCopy.forEach(([from, to]) => {
        Fs.copyFileSync(
            Path.resolve(__dirname, from),
            Path.resolve(__dirname, '..', 'app.guardianapes.com', to)
        )
    })
}


copy()
