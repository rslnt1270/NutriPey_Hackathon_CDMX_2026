# Análisis: contexto educativo y regulatorio

Gráficas en R para el pitch de NutriPey. Muestran el tamaño del sistema educativo, su reparto entre escuelas públicas y privadas, el problema de salud y la regulación de alimentos en escuelas.

## Cómo regenerarlas

**RStudio:** abrir `NutriPey_analisis.Rproj` y ejecutar `source("graficas.R")`.

**Terminal**, desde esta carpeta:

```bash
Rscript graficas.R
```

Paquetes: `ggplot2`, `dplyr`, `readr`, `scales`. Los PNG se escriben en `graficas/` a 2000 px de ancho.

Para actualizar una cifra se edita el CSV correspondiente en `datos/` y se vuelve a ejecutar el script. Los títulos de las gráficas enuncian un hallazgo: si cambian los datos, hay que revisar que el título siga siendo cierto.

## Gráficas

| Archivo | Qué muestra |
| :--- | :--- |
| `01_matricula_por_tipo.png` | Alumnos por tipo educativo y sostenimiento. Básica: 23.4 millones, 11.5% en privadas. |
| `02_participacion_privada_basica.png` | Porcentaje de alumnos en escuelas privadas por nivel de básica. |
| `03_escuelas_primaria_secundaria.png` | Número de escuelas de primaria y secundaria, públicas y privadas. |
| `04_alumnos_por_escuela_vs_n2bis.png` | Alumnos promedio por escuela frente a la capacidad estimada de una cuenta N2Bis. |
| `05_tendencia_matricula.png` | Cambio de la matrícula pública y privada en tres ciclos. |
| `06_sobrepeso_obesidad.png` | Prevalencia de sobrepeso y obesidad en escolares y adolescentes. |
| `07_cronologia_regulacion.png` | Hitos de la regulación de alimentos en escuelas, 2011 a 2026. |

## Fuentes y nivel de verificación

| Datos | Fuente | Verificación |
| :--- | :--- | :--- |
| `sen_2024_2025.csv`, `sen_tendencia.csv` | SEP, [Principales Cifras del Sistema Educativo Nacional 2024-2025](https://www.planeacion.sep.gob.mx/Doc/estadistica_e_indicadores/principales_cifras/principales_cifras_2024_2025_bolsillo.pdf), DGPPyEE, septiembre 2025. | **Fuente primaria.** Cifras copiadas de las tablas del PDF oficial. |
| `ensanut_2020_2022.csv` | Shamah-Levy T. y cols., *Salud Pública de México*, 2023, con datos de la [ENSANUT Continua 2020-2022](https://ensanut.insp.mx/encuestas/ensanutcontinua2022/doctos/analiticos/28-Sobrepeso.y.obesidad-ENSANUT2022-14762-72492-2-10-20230619.pdf). | **Secundaria.** Tomadas de un resumen del artículo. Cotejar con el PDF antes de presentar. |
| `reformas.csv` | Diario Oficial de la Federación; prensa. | **Mixta.** Ver notas abajo. |

### Notas sobre los datos

- **"Privado"** incluye sostenimiento particular y subsidiado, según la definición de la SEP.
- **Gráfica 4:** la línea de 220 alumnos es una estimación propia, no un dato oficial. Divide el límite de 15,000 UDIs mensuales (unos $132,000 MXN) entre un consumo supuesto de $30 diarios por alumno durante 20 días. El promedio nacional incluye escuelas rurales muy pequeñas; las urbanas suelen ser mayores.
- **Gráfica 5:** cubre todo el sistema educativo, incluida la educación superior no escolarizada, que explica parte del crecimiento privado.
- **Gráfica 6:** otro análisis de la misma encuesta reporta 36.5% en escolares y 40.4% en adolescentes. La diferencia viene del corte de años. Hay que citar el periodo junto con la cifra.
- **Gráfica 7:**
  - *Ene 2011* es la entrada en vigor de los primeros lineamientos. La fecha de publicación en el DOF (2010) no se confirmó.
  - *Dic 2023*: la fecha exacta de publicación de la reforma en el DOF debe confirmarse.
  - *Jul 2026*: el 86% proviene de una nota de prensa sobre un reporte de la SEP.

## Datos que faltan

Para reforzar el pitch convendría añadir, cuando se consigan fuentes:

- Escuelas y alumnos de la Ciudad de México por alcaldía (SEP, estadística por entidad).
- Número de cooperativas escolares en operación.
- Gasto diario promedio por alumno en la cooperativa. Hoy es un supuesto de $30.
- Adopción de CoDi entre padres de familia.
