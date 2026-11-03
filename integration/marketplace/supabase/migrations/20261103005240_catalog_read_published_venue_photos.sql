-- Catalog viewers can sign only registered photos of published, approved venues.
create policy marketplace_catalog_photos_select on storage.objects
for select to authenticated
using (
  bucket_id = 'marketplace-venue-photos' and exists (
    select 1
    from public.venue_photos photo
    join public.venues venue on venue.id = photo.venue_id
    join public.partners partner on partner.id = venue.partner_id
    where photo.storage_path = storage.objects.name
      and venue.published and partner.status = 'approved'
      and split_part(storage.objects.name, '/', 1) = partner.id::text
      and split_part(storage.objects.name, '/', 2) = venue.id::text
  )
);
