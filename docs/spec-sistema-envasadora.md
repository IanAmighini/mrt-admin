# Sistema de Gestión — Envasadora de Aceite
## Documento de especificación funcional y modelo de datos (v1)

---

## 1. Alcance general

Web app (responsive, uso en PC y celular), multiusuario, con roles diferenciados, conexión permanente a internet. Reemplaza planillas de Excel/Sheets dispersas. Módulos principales:

1. Cuentas corrientes (clientes y proveedores) — circuito blanco y negro
2. Stock de insumos
3. Stock de producto terminado + producción diaria
4. Armado de pallets
5. Dashboards (proveedores/insumos y clientes/producto terminado)
6. Administración de usuarios y permisos

---

## 2. Usuarios y roles

| Rol | Cantidad estimada | Permisos |
|---|---|---|
| **Admin** | 2 | Acceso total: cuentas corrientes, stock, producción, reportes gerenciales, ganancias, configuración de usuarios e insumos/productos |
| **Carga diaria** (operativo) | 1 (secretaria) | Cargar remitos, facturas, pagos/cobros, producción diaria, movimientos de stock. Sin acceso a reportes gerenciales ni ganancias |
| **Solo lectura** | 2 | Ver dashboards y cuentas corrientes, sin poder editar |

Nota: se define un tercer rol intermedio ("carga diaria") entre admin y solo-lectura.

---

## 3. Entidades (clientes / proveedores)

- Nombre, tipo (cliente / proveedor / ambos), CUIT/datos fiscales, contacto.
- Cada entidad tiene **dos cuentas corrientes independientes**: Blanco y Negro (no se mezclan saldos, pero se ven juntas en la ficha del cliente).
- Condición: ¿es agente de retención/percepción? (booleano, define si esos campos aparecen al cargar una factura para esa entidad).

---

## 4. Circuito Blanco

### 4.1 Remitos / Facturas
- Numeración puede no ser correlativa en el sistema (se carga tal cual el número real del comprobante).
- Factura: monto neto → IVA calculado automáticamente (21% configurable/editable por si hay alícuotas distintas) → retenciones y percepciones **cargadas manualmente, campo opcional** (solo si la entidad es agente).
- Un remito puede estar asociado a una o varias facturas, o facturarse directamente.
- Los precios pueden fijarse en **ARS o USD**. Si es USD, se guarda el tipo de cambio del día de la entrega y se calcula el equivalente en pesos (a integrar: tabla de cotización diaria, manual o por API de referencia tipo "dólar oficial/blue").

### 4.2 Pagos / Cobros
Campos: monto, fecha, forma de pago (efectivo, transferencia, cheque, otro), número de cheque/comprobante (si aplica), a quién se pagó/quién pagó, moneda.

**Imputación de pagos:**
- Método por defecto: **FIFO** (se paga el remito/factura más antiguo pendiente).
- Excepción: la persona que carga el pago puede **elegir manualmente** a qué remito/factura específica se imputa (ej: "este pago es el remito #8" aunque haya remitos más viejos sin cobrar).
- El sistema debe permitir pagos parciales y dejar saldo pendiente visible por comprobante.

### 4.3 Notas de crédito / débito y ajustes
- Nota de crédito: reduce saldo (devoluciones de pallets, bonificaciones).
- Nota de débito: aumenta saldo (cargos adicionales, venta de cajas sueltas u otros ítems fuera del circuito normal de producto).
- Ajuste manual: para correcciones puntuales, con motivo obligatorio (auditable).

### 4.4 Vencimientos
- Tabla de seguimiento con: entidad, comprobante, monto, fecha de vencimiento, estado (pendiente/vencido/pagado).
- Sin automatización de contacto (el seguimiento humano lo hacen ustedes), pero sí alertas visuales en el dashboard de vencidos / por vencer.

---

## 5. Circuito Negro

- Remitos propios (talonarios sin orden fiscal, numeración libre/no correlativa — el sistema no debe validar correlatividad acá).
- Mismos conceptos que en blanco pero sin IVA/retenciones/percepciones: monto, fecha, concepto.
- Pagos: mismos campos que en blanco (monto, fecha, forma de pago, comprobante interno si aplica), mismo criterio de imputación (FIFO por defecto, manual como excepción).
- Notas de crédito/débito y ajustes también aplican al circuito negro.

---

## 6. Stock de insumos

### 6.1 Insumos trackeables
- Aceite a granel (2 tipos, se ingresa por **Kg** desde la pesada y se convierte a **litros** según factor de conversión por tipo de aceite — el factor puede variar levemente según densidad, así que conviene que sea editable por ingreso, no fijo).
- Botellas / bidones (por presentación — algunos son universales entre productos, otros exclusivos).
- Tapas (algunas universales, otras exclusivas).
- Etiquetas (por marca/presentación).
- Cajas (por configuración/presentación).
- Film (para estirchado de pallets).
- Pallets de madera descartables (stock físico separado, se consume 1 por pallet armado — ver sección 8, no se recuperan).
- Cajas de tapitas (vienen de proveedores, se revenden — ver sección 8).
- **Listado abierto**: no hay un catálogo cerrado de insumos. El sistema debe permitir **dar de alta un insumo nuevo en cualquier momento** (nombre, unidad de medida, ¿es revendible?, ¿tiene receta asociada?) sin necesidad de una migración o cambio de estructura. Lo mismo aplica para **proveedores y clientes nuevos**: alta libre en cualquier momento, con su cuenta corriente (blanco/negro) generándose automáticamente al crearlos.

### 6.2 Movimientos de stock y mermas
- Todo movimiento (ingreso de insumo, consumo por producción, ajuste manual) queda registrado en un **historial tipo kardex**: fecha, insumo, cantidad, tipo de movimiento, motivo/origen (ej: "producción del 24/08", "compra a proveedor X", "ajuste por conteo físico", "merma").
- **Sector de mermas**: pantalla/función dedicada para sumar o restar stock manualmente por motivo de merma o ajuste (rotura, faltante de conteo físico, error de carga, etc.), con motivo obligatorio y usuario que lo hizo — queda auditado igual que cualquier otro movimiento.
- Esto permite trazabilidad total y que el stock actual sea siempre "saldo calculado", no un número editado a mano.
- Alertas de stock mínimo: **no se implementa en v1**, pero el modelo lo deja preparado (campo de stock mínimo por insumo, sin lógica de alerta activa todavía).
- No se manejan lotes ni vencimientos (excepto si en el futuro se agrega algo perecedero).

---

## 7. Productos terminados y "recetas" (BOM)

- Producto = combinación de **tipo de aceite × presentación** (ej: Aceite tipo A, botella 1L).
- Cada producto tiene una **receta** (bill of materials): qué insumos y en qué cantidad se consumen por unidad (ej: 1 botella 1L = 1 botella + 1 tapa + 1 etiqueta + 1L de aceite tipo A).
- Las recetas deben ser editables (por si cambian proveedores de insumos o presentaciones).

### 7.1 Carga de producción diaria
- Se carga al final del día, en formato similar al mensaje que hoy reciben: producto, cantidad producida.
- El sistema, usando la receta, calcula automáticamente:
  - Alta de stock de producto terminado (+cantidad producida).
  - Baja de insumos consumidos (según receta × cantidad).
- Debe permitir cargar la producción de **varios productos en un mismo parte diario** (ya que un día se envasan distintas combinaciones).

---

## 8. Pallets

- **Pallet de madera**: es un insumo **descartable** — llega de proveedores (junto con otros insumos que traen) y **no se recupera** al desarmar. Se consume 1 unidad al armar un pallet terminado, y si se desarma, no vuelve a stock de pallets de madera.
- **Cajas de tapitas**: de forma similar, llegan de proveedores y la empresa las revende como insumo/producto secundario (no forman parte del producto final envasado, es una reventa aparte). Se trackean como insumo con su propio stock y también generan movimiento de venta.
- **Pallet terminado** = configuración de cajas apiladas + estirchado (consume: pallet de madera + film + cajas ya cargadas con producto).
- **Film**: es el estrich que envuelve el pallet para que no se desarme. El consumo por pallet es **variable** (no hay un metraje fijo por rollo/pallet) — se descuenta stock de film por evento de armado pero sin una receta rígida de cantidad exacta; se puede cargar la cantidad usada manualmente al armar cada pallet, o llevar el consumo de film como ajuste periódico (a definir cuando se construya este módulo).
- Configuración variable: cantidad de cajas por pallet, y cada caja con su cantidad de botellas/bidones y presentación (ej: "12 pallets de [marca] con [X cajas] x [Y unidades] x [presentación]").
- **Desarmado/rearmado**: debe poder desarmarse un pallet terminado (ej: sacar una fila de cajas) y esas cajas vuelven a stock de "caja armada suelta", sin perder trazabilidad de qué se hizo. El pallet de madera y el film consumidos **se dan de baja como merma/consumo definitivo** al desarmar (no se recuperan).
- Stock de producto terminado entonces tiene niveles: producto suelto (botella/bidón) → caja armada → pallet armado.

---

## 9. Dashboards

### 9.1 Dashboard de Insumos / Proveedores
- Stock actual de cada insumo (aceite, botellas, tapas, etiquetas, cajas, film, pallets, etc.) con indicador visual si está bajo (cuando se implemente el mínimo).
- Cuentas corrientes de proveedores: saldo blanco, saldo negro, y total adeudado por proveedor, ordenado por mayor deuda.
- Vencimientos próximos a pagar.

### 9.2 Dashboard de Producto Terminado / Clientes
- Stock actual por producto (suelto, en cajas, en pallets armados).
- Cuentas corrientes de clientes: saldo blanco, saldo negro, total que adeuda cada cliente, ordenado por mayor deuda.
- Vencimientos próximos a cobrar.

### 9.3 Reportes gerenciales (solo rol Admin)
- **Rentabilidad del mes** (ingresos vs. costos de insumos + otros costos a definir).
- **Litros envasados** por período (por tipo de aceite y total).
- **Valuación de insumos en stock** (cantidad × costo unitario, por insumo y total).
- **Total de producto terminado entregado, valorizado** (cantidad entregada × precio de venta, por período).
- Otros indicadores a sumar más adelante (queda abierto, no cerrado en v1).
- Estos reportes son visibles únicamente para el rol Admin, no para "carga diaria" ni "solo lectura".

---

## 10. Exportación / interoperabilidad

- No se requiere exportación automática en v1, pero al usar una base de datos relacional (Postgres), en cualquier momento se puede:
  - Exportar tablas a CSV/Excel.
  - Conectar Google Sheets como "vista" de solo lectura sobre la base, si se necesita en el futuro.

---

## 11. Fuera de alcance en v1 (pero el modelo lo deja preparado para agregar después)

- Integración con AFIP / facturación electrónica.
- Alertas automáticas de stock mínimo.
- Trazabilidad por lote/vencimiento (no aplica, el aceite no vence).
- Reportes gerenciales avanzados (se define después de tener el core funcionando).

---

## 12. Decisiones confirmadas (actualización)

1. **Insumos**: no hay catálogo cerrado; alta libre de insumos y proveedores/clientes sobre la marcha (ver sección 6.1). Se agrega sector de mermas para ajustes manuales de stock.
2. **Cotización del dólar**: carga manual (no se integra API por ahora).
3. **Pallets/insumos descartables**: pallets de madera y cajas de tapitas llegan de proveedores y no se recuperan al desarmar — algunos incluso se revenden como insumo secundario. Film con consumo variable por pallet (sin receta rígida).
4. **Reportes gerenciales**: rentabilidad mensual, litros envasados, valuación de insumos en stock, producto entregado valorizado (ver sección 9.3).
5. **Migración de datos**: se arranca con **saldos iniciales cargados a mano** como punto de partida (cuentas corrientes y stock), no se migra el histórico completo de los Excel. Si en algún caso puntual se complica, se resuelve sobre la marcha.

## 13. Puntos que quedan abiertos para ir resolviendo durante la construcción

- Detalle exacto de costos a incluir en el cálculo de rentabilidad mensual (además de insumos: ¿mano de obra, alquiler, otros gastos fijos?).
- Mecánica final de registro de consumo de film (carga manual por pallet vs. ajuste periódico).
- Nuevos insumos a trackear que puedan surgir (se resuelve con el alta libre ya prevista).

---

## 14. Próximo paso sugerido

Este documento es la base para empezar la construcción del sistema (backend + base de datos + frontend) de forma iterativa. Por la complejidad (multiusuario, permisos, lógica de negocio con FIFO/imputación manual, BOM de producción, trazabilidad de stock), se recomienda construirlo con **Claude Code**, trabajando módulo por módulo:

1. Modelo de base de datos + autenticación y roles.
2. Cuentas corrientes (blanco/negro, remitos, facturas, pagos, notas de crédito/débito, imputación FIFO/manual).
3. Stock de insumos + recetas + carga de producción diaria.
4. Armado/desarmado de pallets.
5. Dashboards.
