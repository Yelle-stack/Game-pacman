# TODO List for Pacman Game Enhancements

## Approved Plan Implementation

- [x] Add audio elements to index.html for sound effects (removed since no sound files available)
- [x] Update pacman.js variables: add powerPellets, cherries, scaredGhostImage, sounds, levels array, currentLevel, scaredTimer
- [x] Load scaredGhostImage in loadImages()
- [x] Modify tileMap to be an array of 3 different levels
- [x] Update loadMap() to handle 'W' (power pellets) and 'C' (cherries), use currentLevel
- [x] Update draw() to render power pellets and cherries
- [x] Update move() logic: handle eating power pellets (scare ghosts), cherries, eating scared ghosts, scared timer
- [x] Update next level logic to increment currentLevel and cycle through levels
- [x] Add sound playing functions and call them in appropriate places
- [x] Test the game to ensure all features work correctly
