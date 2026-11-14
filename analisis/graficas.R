# NutriPey — Gráficas del contexto educativo y regulatorio
#
# Uso en RStudio: abrir NutriPey_analisis.Rproj y ejecutar source("graficas.R").
# Uso en terminal, desde la carpeta analisis/:  Rscript graficas.R
#
# Lee los CSV de datos/ y escribe los PNG en graficas/.
# Las fuentes de cada cifra están en README.md.

library(ggplot2)
library(dplyr)
library(readr)
library(scales)

dir.create("graficas", showWarnings = FALSE)

# --- Estilo común -----------------------------------------------------------

col_sost   <- c("Público" = "#2a78d6", "Privado" = "#eb6834")
col_peso   <- c("Sobrepeso" = "#86b6ef", "Obesidad" = "#1c5cab")
tinta      <- "#0b0b0b"
tinta_2    <- "#52514e"
superficie <- "#fcfcfb"
rejilla    <- "#e6e5e0"

tema <- theme_minimal(base_size = 13) +
  theme(
    plot.background    = element_rect(fill = superficie, colour = NA),
    panel.background   = element_rect(fill = superficie, colour = NA),
    panel.grid.minor   = element_blank(),
    panel.grid.major.y = element_blank(),
    panel.grid.major.x = element_line(colour = rejilla, linewidth = 0.4),
    plot.title         = element_text(face = "bold", size = 16, colour = tinta),
    plot.subtitle      = element_text(colour = tinta_2, margin = margin(b = 12)),
    plot.caption       = element_text(colour = tinta_2, size = 9, hjust = 0,
                                      margin = margin(t = 12)),
    plot.title.position   = "plot",
    plot.caption.position = "plot",
    axis.title         = element_blank(),
    axis.text          = element_text(colour = tinta_2),
    axis.text.y        = element_text(colour = tinta, size = 12),
    legend.position    = "top",
    legend.justification = "left",
    legend.title       = element_blank(),
    plot.margin        = margin(18, 24, 14, 18)
  )

fuente_sep <- paste(
  "Fuente: SEP, Principales Cifras del Sistema Educativo Nacional 2024-2025",
  "(DGPPyEE, septiembre 2025)."
)

guardar <- function(nombre, grafica, alto = 5.2) {
  ggsave(file.path("graficas", nombre), grafica,
         width = 10, height = alto, dpi = 200, bg = superficie)
  message("Escrita: graficas/", nombre)
}

millones <- function(x) paste0(format(round(x / 1e6, 1), nsmall = 1), " M")
miles    <- function(x) format(x, big.mark = ",", trim = TRUE)

# --- Datos ------------------------------------------------------------------

sen <- read_csv("datos/sen_2024_2025.csv", show_col_types = FALSE) |>
  mutate(sostenimiento = factor(sostenimiento, levels = c("Público", "Privado")))

tendencia <- read_csv("datos/sen_tendencia.csv", show_col_types = FALSE) |>
  mutate(sostenimiento = factor(sostenimiento, levels = c("Público", "Privado")))

ensanut <- read_csv("datos/ensanut_2020_2022.csv", show_col_types = FALSE) |>
  mutate(condicion = factor(condicion, levels = c("Obesidad", "Sobrepeso")))

reformas <- read_csv("datos/reformas.csv", show_col_types = FALSE)

# --- 1. Matrícula por tipo educativo y sostenimiento ------------------------

g1_datos <- sen |>
  group_by(tipo, sostenimiento) |>
  summarise(alumnos = sum(alumnos), .groups = "drop") |>
  group_by(tipo) |>
  mutate(total = sum(alumnos), pct = alumnos / total) |>
  ungroup() |>
  mutate(tipo = factor(tipo, levels = c("Superior", "Media superior", "Básica")))

g1_totales <- g1_datos |>
  filter(sostenimiento == "Privado") |>
  mutate(texto = paste0(millones(total), "  ·  ", percent(pct, accuracy = 0.1),
                        " privado"))

g1 <- ggplot(g1_datos, aes(alumnos, tipo, fill = sostenimiento)) +
  geom_col(width = 0.55, colour = superficie, linewidth = 0.8,
           position = position_stack(reverse = TRUE)) +
  geom_text(data = g1_totales, aes(x = total, y = tipo, label = texto),
            inherit.aes = FALSE, hjust = 0, nudge_x = 3e5, colour = tinta,
            size = 4) +
  scale_fill_manual(values = col_sost) +
  scale_x_continuous(labels = \(x) paste0(x / 1e6, " M"),
                     expand = expansion(mult = c(0, 0.32))) +
  labs(
    title = "La educación básica concentra 23.4 millones de alumnos, casi todos en escuela pública",
    subtitle = "Alumnos por tipo educativo y sostenimiento, ciclo 2024-2025",
    caption = fuente_sep
  ) +
  tema

guardar("01_matricula_por_tipo.png", g1, alto = 4.6)

# --- 2. Participación privada por nivel de educación básica -----------------

g2_datos <- sen |>
  filter(tipo == "Básica") |>
  group_by(nivel) |>
  summarise(pct = sum(alumnos[sostenimiento == "Privado"]) / sum(alumnos),
            privados = sum(alumnos[sostenimiento == "Privado"]),
            .groups = "drop") |>
  mutate(nivel = factor(nivel,
                        levels = c("Secundaria", "Primaria", "Preescolar", "Inicial")),
         texto = paste0(percent(pct, accuracy = 0.1), "  (", miles(privados),
                        " alumnos)"))

g2 <- ggplot(g2_datos, aes(pct, nivel)) +
  geom_col(width = 0.55, fill = col_sost[["Privado"]]) +
  geom_text(aes(label = texto), hjust = 0, nudge_x = 0.01, colour = tinta,
            size = 4) +
  scale_x_continuous(labels = percent, limits = c(0, 0.85),
                     expand = expansion(mult = c(0, 0))) +
  labs(
    title = "En primaria y secundaria, uno de cada diez alumnos estudia en escuela privada",
    subtitle = "Porcentaje de alumnos en escuelas privadas por nivel de educación básica, ciclo 2024-2025",
    caption = fuente_sep
  ) +
  tema

guardar("02_participacion_privada_basica.png", g2, alto = 4.4)

# --- 3. Escuelas de primaria y secundaria: el universo de cooperativas ------

g3_datos <- sen |>
  filter(nivel %in% c("Primaria", "Secundaria")) |>
  mutate(nivel = factor(nivel, levels = c("Secundaria", "Primaria")))

g3 <- ggplot(g3_datos, aes(escuelas, nivel, fill = sostenimiento)) +
  geom_col(width = 0.7, colour = superficie, linewidth = 0.8,
           position = position_dodge2(reverse = TRUE, padding = 0.08)) +
  geom_text(aes(label = paste0("  ", miles(escuelas))),
            position = position_dodge2(width = 0.7, reverse = TRUE),
            hjust = 0, colour = tinta, size = 4) +
  scale_fill_manual(values = col_sost) +
  scale_x_continuous(labels = comma, expand = expansion(mult = c(0, 0.12))) +
  labs(
    title = "139 mil escuelas de primaria y secundaria: el universo donde opera una cooperativa",
    subtitle = "Número de escuelas por nivel y sostenimiento, ciclo 2024-2025",
    caption = fuente_sep
  ) +
  tema

guardar("03_escuelas_primaria_secundaria.png", g3, alto = 4.6)

# --- 4. Tamaño promedio de escuela frente a la capacidad de una cuenta N2Bis

alumnos_n2bis <- 220

g4_datos <- sen |>
  filter(nivel %in% c("Primaria", "Secundaria")) |>
  mutate(por_escuela = alumnos / escuelas,
         grupo = paste(nivel, tolower(sostenimiento)),
         grupo = reorder(grupo, por_escuela))

g4 <- ggplot(g4_datos, aes(por_escuela, grupo, fill = sostenimiento)) +
  geom_col(width = 0.55) +
  geom_vline(xintercept = alumnos_n2bis, colour = tinta, linewidth = 0.6,
             linetype = "dashed") +
  annotate("text", x = alumnos_n2bis - 4, y = 0.52, hjust = 1, vjust = 0,
           colour = tinta, size = 3.8,
           label = "Capacidad estimada de\nuna cuenta N2Bis: 220 alumnos") +
  geom_text(aes(label = round(por_escuela)), hjust = 0, nudge_x = 3,
            colour = tinta, size = 4) +
  scale_fill_manual(values = col_sost) +
  scale_x_continuous(limits = c(0, 245), expand = expansion(mult = c(0, 0))) +
  labs(
    title = "La escuela promedio cabe dentro del límite de una cuenta Nivel 2 Bis",
    subtitle = "Alumnos por escuela (promedio nacional), ciclo 2024-2025",
    caption = paste0(
      fuente_sep,
      "\nCapacidad N2Bis: estimación propia. 15,000 UDIs al mes (unos $132,000 MXN) ",
      "entre $30 diarios por alumno y 20 días de clase.\n",
      "El promedio oculta escuelas urbanas mucho más grandes."
    )
  ) +
  tema

guardar("04_alumnos_por_escuela_vs_n2bis.png", g4, alto = 5)

# --- 5. Tendencia de la matrícula por sostenimiento -------------------------

g5_datos <- tendencia |>
  group_by(sostenimiento) |>
  mutate(indice = alumnos / first(alumnos) * 100) |>
  ungroup()

g5_fin <- g5_datos |>
  filter(ciclo == "2024-2025") |>
  mutate(texto = paste0(sostenimiento, "  ", sprintf("%+.1f%%", indice - 100)))

g5 <- ggplot(g5_datos, aes(ciclo, indice, colour = sostenimiento,
                           group = sostenimiento)) +
  geom_hline(yintercept = 100, colour = rejilla, linewidth = 0.6) +
  geom_line(linewidth = 1) +
  geom_point(size = 3.2) +
  geom_text(data = g5_fin, aes(label = texto), hjust = 0, nudge_x = 0.08,
            colour = tinta, size = 4.2, show.legend = FALSE) +
  scale_colour_manual(values = col_sost) +
  scale_x_discrete(expand = expansion(mult = c(0.08, 0.3))) +
  scale_y_continuous(limits = c(96, 106), breaks = seq(96, 106, 2)) +
  labs(
    title = "La matrícula pública baja mientras la privada crece",
    subtitle = "Alumnos de todo el sistema educativo, índice con base 2022-2023 = 100",
    caption = fuente_sep
  ) +
  tema +
  theme(panel.grid.major.x = element_blank(),
        panel.grid.major.y = element_line(colour = rejilla, linewidth = 0.4),
        axis.text.x = element_text(colour = tinta, size = 12))

guardar("05_tendencia_matricula.png", g5, alto = 5)

# --- 6. Sobrepeso y obesidad en edad escolar --------------------------------

g6_totales <- ensanut |>
  group_by(grupo) |>
  summarise(total = sum(prevalencia), .groups = "drop")

g6 <- ggplot(ensanut, aes(prevalencia, grupo, fill = condicion)) +
  geom_col(width = 0.5, colour = superficie, linewidth = 0.8) +
  geom_text(aes(label = paste0(prevalencia, "%"),
                colour = condicion),
            position = position_stack(vjust = 0.5), size = 4.2,
            show.legend = FALSE) +
  geom_text(data = g6_totales,
            aes(x = total, y = grupo,
                label = paste0("Total ", format(total, nsmall = 1), "%")),
            inherit.aes = FALSE, hjust = 0, nudge_x = 0.8, colour = tinta,
            size = 4.2, fontface = "bold") +
  scale_fill_manual(values = col_peso, breaks = c("Sobrepeso", "Obesidad")) +
  scale_colour_manual(values = c("Sobrepeso" = tinta, "Obesidad" = "#ffffff")) +
  scale_x_continuous(labels = \(x) paste0(x, "%"), limits = c(0, 52),
                     expand = expansion(mult = c(0, 0))) +
  labs(
    title = "Más de un tercio de las niñas y niños en edad escolar tiene sobrepeso u obesidad",
    subtitle = "Prevalencia nacional por grupo de edad, ENSANUT Continua 2020-2022",
    caption = paste(
      "Fuente: Shamah-Levy T. y cols., Salud Pública de México, 2023",
      "(ENSANUT Continua 2020-2022, INSP)."
    )
  ) +
  tema

guardar("06_sobrepeso_obesidad.png", g6, alto = 4.2)

# --- 7. Cronología de la regulación de alimentos en escuelas ----------------

g7_datos <- reformas |>
  mutate(fecha = as.Date(fecha),
         orden = rev(seq_len(n())),
         clave = tipo == "Lineamientos" & fecha == as.Date("2025-03-29"))

g7 <- ggplot(g7_datos, aes(x = 0, y = orden)) +
  annotate("segment", x = 0, xend = 0, y = 1, yend = nrow(g7_datos),
           colour = rejilla, linewidth = 1.2) +
  geom_point(aes(fill = clave), shape = 21, size = 5, colour = superficie,
             stroke = 1.5, show.legend = FALSE) +
  geom_text(aes(x = -0.04, label = etiqueta), hjust = 1, colour = tinta,
            fontface = "bold", size = 4.2) +
  geom_text(aes(x = 0.04, label = detalle), hjust = 0, colour = tinta,
            size = 4.2) +
  scale_fill_manual(values = c(`FALSE` = "#86b6ef", `TRUE` = "#1c5cab")) +
  scale_x_continuous(limits = c(-0.28, 1.7)) +
  scale_y_continuous(expand = expansion(add = 0.6)) +
  labs(
    title = "Quince años de regulación de alimentos en escuelas, hasta la prohibición vigente",
    subtitle = "Hitos de la regulación de alimentos y bebidas en escuelas de México",
    caption = paste0(
      "Fuentes: Diario Oficial de la Federación (16 may 2014, 20 dic 2023, 30 sep 2024); ",
      "NOM-051-SCFI/SSA1-2010 (modificación 2020);\nSEP, estrategia Vive saludable, ",
      "vive feliz (2026). Punto oscuro: la obligación vigente."
    )
  ) +
  tema +
  theme(axis.text.x = element_blank(), axis.text.y = element_blank(),
        panel.grid.major.x = element_blank(),
        panel.grid.major.y = element_blank())

guardar("07_cronologia_regulacion.png", g7, alto = 5.4)
