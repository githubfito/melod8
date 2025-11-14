Play your melodies on the keyboard (white and black notes) to generate a basic file compatible with Amstrad CPC, ZX Spectrum or PowerBasic.
Load these files onto that hardware and the melody you played on the keyboard will be played back.

Try it here:
https://githubfito.github.io/melod8/

* Example of basic code generated for Amstrad CPC:

```basic
10 REM MELOD8 by fitosoft AMSTRAD CPC BASIC
20 REM Inicializacion de reproduccion
30 RESTORE 100: DIM D(2): REM D(1)=Pitch, D(2)=Duration
40 FOR I = 1 TO 71
50 READ D(1), D(2)
60 IF D(1) = -1 THEN END: REM Final de datos
70 SOUND 2,D(1),D(2)
80 NEXT I
100 DATA 113,13,1,5,127,15,113,46,1,10,169,54,1,62,106,15,1,5,113,14
110 DATA 106,19,1,10,113,13,1,15,127,67,1,62,106,14,1,5,113,11,1,5
120 DATA 106,49,1,9,169,48,1,15,151,60,1,34,127,18,142,18,127,14,1,15
130 DATA 142,14,1,16,151,14,1,16,127,23,1,10,142,66,1,27,151,12,1,9
140 DATA 142,10,1,5,127,50,1,40,142,11,1,5,127,11,1,10,113,12,1,16
150 DATA 127,14,1,17,142,13,1,15,151,13,1,18,169,49,1,9,106,30,1,26
160 DATA 113,70,1,43,113,20,1,12,106,39,1,11,113,10,1,6,127,10,1,6
170 DATA 113,86
180 DATA -1, 0
190 PRINT"pulsa una tecla"
200 WHILE INKEY$="":WEND
210 END
```

* Example of basic code generated for zx Spectrum:
  
```basic
10 REM MELOD8 by fitosoft ZX BASIC
20 REM Inicializacion de reproduccion
30 RESTORE 90
40 READ P, D
50 IF P = -99 THEN STOP: REM Final de datos
60 IF P = 99 THEN PAUSE D: GOTO 40
70 BEEP D, P: GOTO 40
80 REM Continuar
90 DATA 4,0.129,99,3,2,0.153,4,0.464,99,5,-3,0.543,99,31,5,0.152
100 DATA 99,3,4,0.143,5,0.191,99,5,4,0.128,99,8,2,0.665,99,31
110 DATA 5,0.143,99,3,4,0.105,99,3,5,0.488,99,4,-3,0.480,99,7
120 DATA -1,0.599,99,17,2,0.183,0,0.184,2,0.143,99,8,0,0.144,99,8
130 DATA -1,0.136,99,8,2,0.225,99,5,0,0.663,99,14,-1,0.119,99,4
140 DATA 0,0.104,99,3,2,0.496,99,20,0,0.105,99,3,2,0.111,99,5
150 DATA 4,0.118,99,8,2,0.136,99,9,0,0.128,99,8,-1,0.128,99,9
160 DATA -3,0.488,99,5,5,0.304,99,13,4,0.701,99,22,4,0.200,99,6
170 DATA 5,0.393,99,6,4,0.096,99,3,2,0.096,99,3,4,0.863
180 DATA -99,0
1000 STOP
```

You can use the fantastic Amstrad emulator provided by ‘benchmarko’ that allows you to paste basic code directly. It's impressive. Thanks to the author.
https://benchmarko.github.io/CPCBasic/index.html

If you generate basic audio files, remember to mention MELOD8 and the author (fitosoft).

November/2025
fito
