# Solitario Iaia

Un solitario clásico (Klondike) **sin anuncios**, sin cuenta y sin conexión.
Se instala en el móvil Android como una app y funciona sin internet.

**Jugar:** https://danisr2-games.github.io/solitario-iaia/

![Icono](icons/icon-192.png)

## Instalarlo en Android

1. Abre el enlace de arriba con **Chrome** en el móvil.
2. Toca el menú **⋮** y luego **Instalar aplicación** (o «Añadir a pantalla de inicio»).
3. Aparece el icono en la pantalla de inicio. Se abre a pantalla completa y, después de la primera vez, funciona sin conexión.

## Cómo se juega

- Sube todas las cartas a las cuatro pilas de arriba, del as al rey y del mismo palo.
- En las columnas, pon cada carta sobre una de un número más alto y del otro color. En una columna vacía solo va un rey.
- **Toca** una carta y se va sola al mejor sitio, o **arrástrala**.
- Puedes sacar **1 o 3 cartas** por turno (en el menú).
- Tienes **Deshacer**, **Pista** y el botón **Terminar ya** cuando todas las cartas están boca arriba.

## Monedas y tienda

Cada partida ganada da monedas: **20 por ganar + 1 por cada 4 segundos por debajo de 10 minutos**.
Cuanto más rápido, más monedas.

| tiempo | monedas |
| --- | --- |
| 1:30 | 148 |
| 3:00 | 125 |
| 6:00 | 80 |
| 10:00 o más | 20 |

Con 3 cartas por turno ganas un 50 % más. Si vuelves a empezar la misma partida, la mitad.

En la **tienda** se gastan en:

- **Ventajas:** paquetes de pistas (cada partida trae 3 gratis), vistazos para ver una carta boca abajo,
  más pistas gratis por partida y la «Bolsa de la suerte» (+25 % de monedas).
- **Aspecto:** dorsos de carta, tapetes y una baraja de 4 colores.

## Privacidad

No hay anuncios, ni cuenta, ni estadísticas de uso. La partida, las monedas y las compras se guardan
solo en tu móvil. La app no se conecta a ningún servidor después de instalarse.

## Archivos

```
index.html, style.css   la interfaz
js/game.js              las reglas del solitario
js/economy.js           monedas, precios y tienda
js/ui.js                la mesa, tocar y arrastrar, menús y guardado
sw.js                   el funcionamiento sin conexión
manifest.webmanifest    el nombre y los iconos para instalarla
icons/                  los iconos
```

Hecho con HTML, CSS y JavaScript, sin librerías ni dependencias.
