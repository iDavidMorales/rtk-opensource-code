
  - Si vas a crear una PDVDATA.FDB nueva para que el puente funcione bien, lo importante no es copiar “toda Eleventa”, sino asegurar las tablas que el receptor y el agente realmente leen.
  - Para api/eleventa/recibir-tickets.php, lo mínimo útil es que la base tenga cabecera de ticket, detalle de ticket y catálogo de productos.
  - Si además quieres que el POS siga funcionando mejor, conviene agregar usuarios, cajas y clientes.

  WOW upgrades

  - Esquema mínimo viable para sincronizar ventas.
  - Esquema recomendado para que el POS quede más sólido.
  - Mapeo claro de qué se lee de PDVDATA.FDB y qué se manda al API.
  - Te dejo también el payload exacto para probarlo.

  ## 1. Tablas mínimas que deberías crear

  Si el objetivo es que el agente lea ventas y mande a recibir-tickets.php, yo crearían estas primero:

  ### VENTATICKETS

  Cabecera del ticket.

  Campos mínimos recomendados:

  - ID INTEGER o BIGINT
  - FOLIO VARCHAR(50)
  - CAJA_ID INTEGER
  - CAJERO_ID INTEGER
  - NOMBRE VARCHAR(255)
  - CREADO_EN TIMESTAMP
  - SUBTOTAL NUMERIC(18,2)
  - IMPUESTOS NUMERIC(18,2)
  - TOTAL NUMERIC(18,2)
  - GANANCIA NUMERIC(18,2)
  - ESTA_ABIERTO SMALLINT
  - CLIENTE_ID INTEGER
  - VENDIDO_EN TIMESTAMP
  - ES_MODIFICABLE SMALLINT
  - PAGO_CON NUMERIC(18,2)
  - MONEDA VARCHAR(10)
  - NUMERO_ARTICULOS INTEGER
  - PAGADO_EN TIMESTAMP
  - ESTA_CANCELADO SMALLINT
  - OPERACION_ID VARCHAR(50) o INTEGER
  - OLD_TICKET_ID INTEGER
  - NOTAS VARCHAR(500)
  - IMPRIMIR_NOTA SMALLINT
  - FORMA_PAGO VARCHAR(50)
  - REFERENCIA VARCHAR(100)
  - FACTURA_ID INTEGER
  - TOTAL_DEVUELTO NUMERIC(18,2)

  ### VENTATICKETS_ARTICULOS

  Detalle del ticket.

  Campos mínimos recomendados:

  - ID INTEGER o BIGINT
  - TICKET_ID INTEGER o BIGINT
  - PRODUCTO_CODIGO VARCHAR(50)
  - PRODUCTO_NOMBRE VARCHAR(255)
  - CANTIDAD NUMERIC(18,3)
  - GANANCIA NUMERIC(18,2)
  - DEPARTAMENTO_ID INTEGER
  - PAGADO_EN TIMESTAMP
  - USA_MAYOREO SMALLINT
  - PORCENTAJE_DESCUENTO NUMERIC(9,2)
  - COMPONENTES VARCHAR(500)
  - IMPUESTOS_USADOS NUMERIC(18,2)
  - IMPUESTO_UNITARIO NUMERIC(18,2)
  - PRECIO_USADO NUMERIC(18,2)
  - CANTIDAD_DEVUELTA NUMERIC(18,3)
  - FUE_DEVUELTO SMALLINT
  - PORCENTAJE_PAGADO NUMERIC(9,2)

  ### PRODUCTOS

  Catálogo.

  Campos mínimos recomendados:

  - CODIGO VARCHAR(50) o INTEGER
  - DESCRIPCION VARCHAR(255)
  - PVENTA NUMERIC(18,2)
  - PCOSTO NUMERIC(18,2)
  - DINVENTARIO NUMERIC(18,3)
  - DINVM M ERIC(18,2)
  - CHECADO_EN TIMESTAMP

  ## 2. Tablas recomendadas para que quede más completo

  Estas no son estrictamente obligatorias para el primer sync, pero sí ayudan mucho:

  ### USUARIOS

  Para asociar cajeros / operadores.

  Campos:

  - ID
  - NOMBRE_COMPLETO
  - NOMBRE- ACTIVO`
  - CAJA_ID

  ### CAJAS

  Para identificar la terminal / punto de cobro.

  Campos:

  - ID
  - NOMBRE
  - DESCRIPCION
  - ACTIVA

  ### CLIENTES

  Si vas a manejar crédito o clientes frecuentes.

  Campos:

  - ` de stock.

  ### HISTORIAL_USUARIOS

  Si quieres auditoría de acciones.

  ## 3. Qué debe leer el agente para mandar a recibir-tickets.php

  Para que agente.js pueda construir el JSON, debe poder obtener:

  - De VENTATICKETS:
      - ID
      - FOLIO
      - CAJA_ID
      - CAJERO_ID
      - CREADO_EN
      - SUBTOTAL
      - IMPUESTOS
      - TOTAL
      - PAGO_CON
      - FORMA_PAGO
      - PAGADO_EN
      - `ESTA esto:

    "auth": {
      "api_key": "rt_live_8f7d6e5c4b3a2",
      "user_id": 31,
      "id_tienda": "tienda_00192",
      "connection_id": "elv_win_001"
    },
    "sales": [
      {
        "syncId": "ELV-2908",
        "folio": "ELV-290",
        "folio": "ELV-2908",
        "ticketId": 1582514626,
        "storeId": "com_0000068",
        "cashierId": .24,
        "total": 16.24,
        "paidWith": 20.00,
        "change": 3.76,
        " de esquema

  Si quieres que esto funcione sin pelearte después, yo haría este orden:

  1. `VENTATICKETS`
  2. `VENTATICKETS_ARTICULOS`
  3. `PRODUCTOS`
  4. `USUARIOS`
  5. `CAJAS`
  6. `CLIENTES`
  7. `IMPUESTOS`

  Con eso ya puedes:
  - leer tickets
  - armar detalle
  - identificar caja/cajero
  - sincronizar a Routicket
  - imprimir ticket con nombre y totales

  ## 6. Lo que yo te sugiero pedirle a quien genere la `PDVDATA.FDB`

  Pídeles esto:
  - Crear tablas `VENTATICKETS`, `VENTATICKETS_ARTICULOS`, `PRODUCTOS`, `USUARIOS`, `CAJAS`, `CLIENTES`, `IMPUEST_ID` como vínculo a la cabecera

  ## 7. Si quieres ir a lo seguro

  Puedo prepararte ahora mismo cualquiera de estas dos cosas:

  1. Un `CREATE TABLE` completo para Firebird/InterBase con estas tablas.
  2. Un `INSERT` de ejemplo para probar `VENTATICKETS` y `VENTATICKETS_ARTICULOS`.
  3. Un tablas y el payload que recibe `recibir-tickets.php`.


