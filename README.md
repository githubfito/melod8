Play your melodies on the keyboard (white and black notes) to generate a basic file compatible with Amstrad CPC, ZX Spectrum or PowerBasic.
Load these files onto that hardware and the melody you played on the keyboard will be played back.

Try it here:
https://githubfito.github.io/melod8/

* Example of basic code generated for Amstrad CPC:
10 REM MELOD8 by fitosoft AMSTRAD CPC BASIC
20 REM Inicializacion de reproduccion
30 RESTORE 100: DIM D(2): REM D(1)=Pitch, D(2)=Duration
40 FOR I = 1 TO 114
50 READ D(1), D(2)
60 IF D(1) = -1 THEN END: REM Final de datos
70 SOUND 2,D(1),D(2)
80 NEXT I
100 DATA 239,14,1,4,213,15,1,2,189,13,1,18,159,10,1,21,159,36,1,17
110 DATA 142,8,1,5,159,11,1,19,189,12,1,19,239,42,1,12,213,8,1,4
120 DATA 189,12,1,20,189,10,1,23,213,14,1,16,239,14,1,16,213,74,1,27
130 DATA 239,13,1,4,213,14,1,2,189,13,1,17,159,10,1,19,159,41,1,13
140 DATA 142,8,1,4,159,18,1,17,189,16,1,16,239,47,1,9,213,8,1,4
150 DATA 189,14,1,20,189,10,1,19,213,13,1,19,213,14,1,20,239,50,1,19
160 DATA 239,61,1,15,179,59,1,13,179,64,1,7,142,10,1,24,142,44,1,18
170 DATA 142,14,1,19,159,42,1,10,142,20,159,20,1,16,189,20,1,16,213,73
180 DATA 1,29,239,12,1,4,213,14,1,4,189,15,1,16,159,14,1,17,159,42
190 DATA 1,7,142,16,1,3,159,11,1,20,189,18,1,16,239,52,1,11,213,8
200 DATA 1,3,189,14,1,18,189,14,1,19,213,10,1,21,213,15,1,24,239,24
210 DATA 1,8,120,24,1,9,239,70
220 DATA -1, 0
230 PRINT"pulsa una tecla"
240 WHILE INKEY$="":WEND
250 END

If you generate basic audio files, remember to mention MELOD8 and the author (fitosoft).

November/2025
fito
