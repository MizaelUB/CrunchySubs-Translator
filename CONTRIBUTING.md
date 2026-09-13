# Guía de Contribución

¡Gracias por tu interés en contribuir a **CrunchySubs-Translator & Tools**! Toda ayuda es bienvenida para mejorar la extensión.

## Cómo contribuir

1. **Haz un Fork** del repositorio en GitHub.
2. **Clona** tu fork localmente: `git clone https://github.com/MizaelUB/CrunchySubs-Translator.git`
3. **Crea una rama** para tu funcionalidad o corrección de error: `git checkout -b feature/nueva-funcion` o `git checkout -b fix/correccion-bug`.
4. **Realiza tus cambios**. Asegúrate de mantener la coherencia con el estilo de código existente.
5. **Prueba tu código**. Carga la extensión descomprimida en tu navegador (`chrome://extensions/`) y verifica que los subtítulos se inyecten correctamente en el reproductor.
6. **Haz un Commit** con un mensaje claro y descriptivo.
7. **Sube tus cambios** (Push) a tu fork en GitHub.
8. **Abre un Pull Request** (PR) hacia la rama principal de este repositorio.

## Reglas y Buenas Prácticas

- Prioriza siempre la **seguridad**.
- Usa JavaScript puro (Vanilla JS) y no añadas dependencias pesadas si no es estrictamente necesario.
- No dejes comentarios innecesarios en el código de producción.
- No introduzcas llamadas a APIs externas ajenas a la funcionalidad base de la extensión (por motivos de privacidad).

¡Cualquier aporte, ya sea en forma de código, reporte de bugs, o sugerencias visuales, es muy apreciado!
