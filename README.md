# sistema-admin-rifas

Proyecto: sistema administrativo de rifas (reservas atómicas con raffle_numbers)  
Stack: Node.js (Express), MariaDB (MySQL), tests con Jest + Supertest

Requisitos
- Node 18+
- MariaDB (InnoDB)
- npm
- (Opcional) GitHub CLI `gh` para crear repositorio desde terminal

Instalación rápida
1. Clona (o crea) carpeta del proyecto:
   mkdir -p ~/sistema-admin-rifas && cd ~/sistema-admin-rifas

2. Copia los archivos del proyecto (package.json, src/, migrations/, tests/, .env.example, README.md).

3. Instala dependencias:
   npm install

4. Configura variables de entorno:
   export DATABASE_URL="mysql://dbuser:dbpass@127.0.0.1:3306/rifas_db"
   export RESERVATION_TTL_MINUTES=30
   export PORT=3000

5. Ejecuta migraciones (en MariaDB):
   mysql -u dbuser -p rifas_db < migrations/schema-mariadb.sql
   mysql -u dbuser -p rifas_db < migrations/schema-mariadb-rafflenumbers.sql

   - Para poblar números: llamarás al endpoint POST /api/raffles/:raffleId/populate o invocarás el SP: CALL populate_raffle_numbers('<raffle_id>', total);

6. Ejecuta servidor:
   npm start

Ejecutar tests E2E (requiere DB limpia con migraciones aplicadas):
   npm test

Endpoints principales (resumen)
- POST /api/raffles -> crear rifa
- POST /api/raffles/:raffleId/populate -> poblar raffle_numbers (usa stored procedure)
- POST /api/raffles/:raffleId/preorders -> crear precompra y reservar número
- POST /api/preorders/:preorderId/payments -> subir comprobante
- POST /api/admin/preorders/:preorderId/validate -> admin valida/rechaza
- El sistema libera reservas expiradas automáticamente mediante un job interno.

Notas de seguridad y producción
- Proteger endpoints admin con autenticación/roles (no incluido en MVP).
- Guardar capturas en S3 / MinIO y proteger acceso.
- Configurar notificaciones reales (SendGrid, Twilio).
```
