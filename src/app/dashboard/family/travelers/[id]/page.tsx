"use client";

import { getCurrentFamilyTraveler, type TravelerDTO } from '@/actions/travelers';
import { Avatar, ErrorState, Feedback, GlassCard, LoadingState, PageHeader, PrimaryButton, SecondaryButton, SectionHeader, StatusBadge, Timeline } from '@/components/app/ui';
import { useAppAuth } from '@/lib/auth/provider';
import { use, useEffect, useState } from 'react';
import { notFound } from 'next/navigation';

export default function TravelerDetailPage({
  params
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = use(params);
  const { isLoaded, session } = useAppAuth();
  const [traveler, setTraveler] = useState<TravelerDTO | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isLoaded) return;
    if (!session || session.user.role !== 'family') { setIsLoading(false); return; }
    void loadTraveler();
  }, [id, isLoaded, session]);

  async function loadTraveler() {
    try {
      setIsLoading(true);
      const result = await getCurrentFamilyTraveler(id);
      if (!result.success) throw new Error(result.error);
      setTraveler(result.traveler);
    } catch (err) {
      console.error('Error loading traveler:', err);
      setError('Failed to load traveler details');
    } finally {
      setIsLoading(false);
    }
  }

  if (isLoading || !isLoaded) {
    return <LoadingState label="Loading traveler details..." />;
  }

  if (!session || session.user.role !== 'family') {
    return <GlassCard><ErrorState message="This page is only available to family users." /></GlassCard>;
  }

  if (error) {
    return <GlassCard><ErrorState message={error} action={<SecondaryButton href="/dashboard/family/travelers" icon="back">Back to Travelers</SecondaryButton>} /></GlassCard>;
  }

  if (!traveler) {
    return notFound();
  }

  return (
    <div className="tb-page">
      <PageHeader
        title="Traveler Profile"
        eyebrow="Care starts with knowing the traveler"
        description="Personal details, practical assistance and contacts for planning the next journey."
        backHref="/dashboard/family/travelers"
        backLabel="Back to Travelers"
        actions={<PrimaryButton href={`/dashboard/family/travelers/${traveler.id}/edit`} icon="edit">Edit Traveler</PrimaryButton>}
      />
      <div className="tb-grid">
        <GlassCard tone="accent">
          <SectionHeader title="Personal details" icon="user" />
          <div className="tb-stack">
            <div className="tb-profile-card-heading">
              <Avatar name={`${traveler.first_name} ${traveler.last_name}`} size="large" />
              <div className="tb-min-zero">
                <h3>{traveler.first_name} {traveler.last_name}</h3>
                <p className="tb-muted tb-small">Family traveler</p>
              </div>
              <StatusBadge status="Profile saved" tone="info" />
            </div>
            <dl className="tb-details">
              <div><dt>First Name</dt><dd>{traveler.first_name}</dd></div>
              <div><dt>Last Name</dt><dd>{traveler.last_name}</dd></div>
              <div><dt>Date of Birth</dt><dd>{traveler.date_of_birth ? new Date(traveler.date_of_birth).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' }) : 'Not specified'}</dd></div>
              <div><dt>Traveler ID</dt><dd>{traveler.id}</dd></div>
            </dl>
          </div>
        </GlassCard>
        <GlassCard>
          <SectionHeader title="Assistance & accessibility" description="Needs recorded on this traveler’s profile." icon="heart" />
          <dl className="tb-details">
            <div><dt>Medical Conditions</dt><dd>{traveler.medical_conditions.length > 0 ? traveler.medical_conditions.join(', ') : 'None recorded'}</dd></div>
            <div><dt>Accessibility Needs</dt><dd>{traveler.accessibility_needs.length > 0 ? traveler.accessibility_needs.join(', ') : 'None recorded'}</dd></div>
          </dl>
          <hr className="tb-divider" />
          <p className="tb-muted tb-small">Review these details with the traveler before arranging assistance for a trip.</p>
          <a className="tb-link" href={`/dashboard/family/travelers/${traveler.id}/edit`}>Update assistance details</a>
        </GlassCard>
        <GlassCard>
          <SectionHeader title="Emergency Contacts" description="People listed for this traveler." icon="users" />
          {traveler.emergency_contacts?.primary_name || traveler.emergency_contacts?.secondary_name ? (
            <div className="tb-stack">
              <dl className="tb-details">
                {traveler.emergency_contacts.primary_name && <div><dt>Primary Contact</dt><dd>{traveler.emergency_contacts.primary_name}<br />{traveler.emergency_contacts.primary_phone || 'Phone not recorded'}</dd></div>}
                {traveler.emergency_contacts.secondary_name && <div><dt>Secondary Contact</dt><dd>{traveler.emergency_contacts.secondary_name}<br />{traveler.emergency_contacts.secondary_phone || 'Phone not recorded'}</dd></div>}
              </dl>
              {(!traveler.emergency_contacts.primary_name || !traveler.emergency_contacts.primary_phone) && <Feedback tone="warning">Review the primary contact’s name and phone number before travel.</Feedback>}
            </div>
          ) : <Feedback tone="warning">No emergency contacts recorded. Add a primary contact before planning the next journey.</Feedback>}
          <hr className="tb-divider" />
          <SecondaryButton href={`/dashboard/family/travelers/${traveler.id}/edit`} icon="edit">Review Contacts</SecondaryButton>
        </GlassCard>
        <GlassCard tone="info">
          <SectionHeader title="Safety preparation" description="A practical guide to review before the next journey." icon="shield" />
          <Timeline steps={[
            { label: 'Confirm contact details', description: 'Check that the listed people can be reached during travel.', status: 'current' },
            { label: 'Review assistance needs', description: 'Talk through comfort, accessibility and support with the traveler.', status: 'upcoming' },
            { label: 'Add journey-specific details', description: 'Include the route, dates and assistance instructions in a trip request.', status: 'upcoming' },
          ]} />
          <SecondaryButton href="/dashboard/family/trip-requests/new" icon="plane">Create Trip</SecondaryButton>
        </GlassCard>
      </div>
    </div>
  );
}
