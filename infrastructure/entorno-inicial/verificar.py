"""Validación estática sin Docker, red, AWS ni secretos. Requiere PyYAML."""
from pathlib import Path
import unittest
import yaml

ROOT = Path(__file__).resolve().parent


class Configuracion(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.config = yaml.safe_load((ROOT / "compose.yaml").read_text())
        cls.services = cls.config["services"]

    def test_solo_proxy_publica_puertos(self):
        self.assertEqual(self.services["proxy"]["ports"], ["80:80", "443:443"])
        for name in ("app", "db"):
            self.assertNotIn("ports", self.services[name])
        self.assertEqual(self.services["db"]["networks"], ["database"])
        self.assertTrue(self.config["networks"]["database"]["internal"])
        self.assertNotIn("database", self.services["proxy"]["networks"])

    def test_persistencia_y_arranque(self):
        self.assertIn("postgres-data:/var/lib/postgresql", self.services["db"]["volumes"])
        self.assertIn("caddy-data:/data", self.services["proxy"]["volumes"])
        for service, dependency in (("app", "db"), ("proxy", "app")):
            self.assertEqual(self.services[service]["depends_on"][dependency]["condition"], "service_healthy")

    def test_sin_build_ni_credenciales_por_defecto(self):
        for service in self.services.values():
            self.assertNotIn("build", service)
            self.assertIn(":?", service["image"])
            self.assertEqual(service["logging"]["options"]["max-file"], "3")
        self.assertIn(":?", self.services["app"]["env_file"][0])
        self.assertIn(":?", self.services["db"]["environment"]["POSTGRES_PASSWORD"])
        for line in (ROOT / ".env.example").read_text().splitlines():
            if line and not line.startswith("#"):
                self.assertEqual(line.split("=", 1)[1], "")

    def test_proxy_acotado_sin_logs_de_acceso(self):
        caddy = (ROOT / "Caddyfile").read_text()
        self.assertIn("@integration path /api/health /api/webhooks/pey", caddy)
        self.assertIn("reverse_proxy app:3000", caddy)
        self.assertIn("respond 404", caddy)
        self.assertFalse(any(line.strip().startswith("log") for line in caddy.splitlines()))


if __name__ == "__main__":
    unittest.main(verbosity=2)
